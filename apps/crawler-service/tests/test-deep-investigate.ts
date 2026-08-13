/**
 * Deep investigation into the Apifox page:
 * 1. Log ALL network requests
 * 2. Scan window globals for Dva/UMI/Redux references
 * 3. Scan fiber tree contexts for store-like objects
 * 4. Try to find and access the store through React internals
 */
import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];
const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";
const FAKE_USER = { id: 3232299, name: "狐友UgzW", username: "狐友UgzW" };

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);
  await ctx.addInitScript(`
    (function() {
      var op = history.pushState;
      history.pushState = function(s,t,u) { if(String(u).includes("/user/login")) return; return op.apply(this,arguments); };
      var or_ = history.replaceState;
      history.replaceState = function(s,t,u) { if(String(u).includes("/user/login")) return; return or_.apply(this,arguments); };
    })()
  `);

  const page = await ctx.newPage();

  // Log ALL network requests for debugging
  const allReqs: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    const type = req.resourceType();
    if (type === "xhr" || type === "fetch") {
      allReqs.push(`[${req.method()}] ${url.slice(0,200)} (${type})`);
      log(`REQ [${type}] ${req.method()} ${url.slice(0,150)}`);
    }
  });
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("apifox.com/api") || url.includes("api.apifox.com")) {
      log(`RES ${res.status()} ${url.slice(0,150)}`);
    }
  });

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 60000 });
  log(`Page loaded. URL: ${page.url()}`);

  // Wait more for async initialization
  await page.waitForTimeout(5000);
  log(`After wait. URL: ${page.url()}`);

  // ====== 1. Scan window globals ======
  const globals = await page.evaluate(`
    (function() {
      var storeKeys = [];
      var found = {};
      for (var k in window) {
        var v = window[k];
        if (typeof v === "object" && v !== null && v !== window) {
          if (k.toLowerCase().indexOf("store") >= 0 || k.toLowerCase().indexOf("dva") >= 0 ||
              k.toLowerCase().indexOf("redux") >= 0 || k.toLowerCase().indexOf("umi") >= 0 ||
              k.toLowerCase().indexOf("react") >= 0) {
            storeKeys.push(k + ":" + typeof v + ":" + (Array.isArray(v)?"array":Object.keys(v||{}).slice(0,5).join(",")));
          }
        } else if (typeof v === "function" && k.toLowerCase().indexOf("store") >= 0) {
          storeKeys.push(k + ":function");
        }
      }
      // Also check for React dev tools global
      found.__REACT_DEVTOOLS_GLOBAL_HOOK__ = typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      found.__dva_store__ = typeof window.__dva_store__;
      found.g_app = typeof window.g_app;
      found.__umi_eager_models = typeof window.__umi_eager_models;

      return JSON.stringify({ storeKeys, found }, null, 2);
    })()
  `);
  log(`=== Window Globals ===\n${globals}`);

  // ====== 2. Scan fiber tree contexts for store ======
  const ctxScan = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      if (!root) return "no_root";
      var rk = Object.keys(root).find(function(k) {
        return k.startsWith("__reactFiber") || k.startsWith("__reactContainer");
      });
      if (!rk) return "no_fiber_key:" + Object.keys(root).join(",");

      var providers = [];
      var contexts = [];

      var walk = function(fiber, depth) {
        if (!fiber || depth > 55) return;

        // ContextProvider has fiber.tag === 10 (React 16+) or tag === 12 (React 16.12+)
        // For React 18, ContextProvider tag is 10 or 201 for SSR
        if (fiber.tag === 10) {
          var ctx = fiber.type && fiber.type._context || fiber.type;
          var val = fiber.memoizedProps?.value;
          var valType = val === undefined ? "undefined" : val === null ? "null" : typeof val;
          var valKeys = (val && typeof val === "object" && !Array.isArray(val)) ? Object.keys(val).slice(0, 15) : null;
          var isStoreLike = valKeys && (valKeys.indexOf("dispatch") >= 0 || valKeys.indexOf("store") >= 0 ||
                           valKeys.indexOf("getState") >= 0);

          providers.push({
            depth,
            valType,
            valKeys,
            isStoreLike,
            hasDispatch: valKeys && valKeys.indexOf("dispatch") >= 0,
            storeKeys: valKeys && valKeys.indexOf("dispatch") >= 0 ? JSON.stringify(valKeys) : null,
          });

          // If value has dispatch, check what actions are available
          if (val && typeof val.dispatch === "function") {
            contexts.push({
              depth,
              valKeys,
              valType,
            });
          }
        }

        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };

      try { walk(root[rk], 0); } catch(e) { return "walk_err:" + e.message; }
      return JSON.stringify({ providers, contexts, total: providers.length }, null, 2);
    })()
  `);
  log(`=== Context Providers ===\n${ctxScan}`);

  // ====== 3. Scan hooks for store reference ======
  const hookScan = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) {
        return k.startsWith("__reactFiber") || k.startsWith("__reactContainer");
      });
      if (!rk) return "no_key";

      var stores = [];

      var walk = function(fiber, depth) {
        if (!fiber || depth > 55) return;

        var hook = fiber.memoizedState;
        var idx = 0;
        while (hook && idx < 40) {
          var v = hook.memoizedState;

          // Check for store reference in useMemo memory
          if (Array.isArray(v) && v.length === 2) {
            // [memoizedValue, deps]
            var mv = v[0];
            if (mv && typeof mv === "object") {
              var mvKeys = Object.keys(mv);
              if (mvKeys.indexOf("dispatch") >= 0 || mvKeys.indexOf("store") >= 0 ||
                  mvKeys.indexOf("getState") >= 0) {
                stores.push({
                  depth, hookIdx: idx,
                  keys: mvKeys.slice(0, 10),
                  hasDispatch: typeof mv.dispatch === "function",
                  hasGetState: typeof mv.getState === "function",
                  hasStore: typeof mv.store === "object",
                });
              }
            }
          } else if (v && typeof v === "object" && !Array.isArray(v)) {
            // Direct state object
            var keys = Object.keys(v);
            if (keys.indexOf("dispatch") >= 0 || keys.indexOf("store") >= 0 ||
                keys.indexOf("getState") >= 0) {
              stores.push({
                depth, hookIdx: idx,
                keys: keys.slice(0, 10),
                hasDispatch: typeof v.dispatch === "function",
                hasGetState: typeof v.getState === "function",
              });
            }

            // Check for initialState
            if (keys.indexOf("initialState") >= 0 && keys.indexOf("setInitialState") >= 0) {
              stores.push({
                depth, hookIdx: idx,
                type: "initialStateModel",
                initialState: v.initialState,
                hasSetInit: typeof v.setInitialState === "function",
                hasRefresh: typeof v.refresh === "function",
                loading: v.loading,
              });
            }
          }

          // Check hook.queue for dispatch-like objects
          if (hook.queue) {
            try {
              var q = hook.queue;
              // For useReducer, queue has dispatch function
              if (typeof q.dispatch === "function") {
                stores.push({
                  depth, hookIdx: idx,
                  type: "reducerHook",
                  hasDispatch: true,
                });
              }
            } catch(e) {}
          }

          hook = hook.next;
          idx++;
        }

        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };

      try { walk(root[rk], 0); } catch(e) { return "walk_err:" + e.message; }
      return JSON.stringify({ stores, total: stores.length }, null, 2);
    })()
  `);
  log(`=== Hook Store Scan ===\n${hookScan}`);

  // ====== 4. Check page content ======
  const bodyInfo = await page.evaluate(`
    JSON.stringify({
      url: location.href,
      bodyLen: document.body?.innerHTML?.length || 0,
      bodyText: (document.body?.innerText || "").slice(0, 300),
      hasRoot: !!document.getElementById("root"),
      rootChildren: document.getElementById("root")?.children?.length || 0,
      hasLoginForm: !!document.querySelector("form"),
      hasAntdSpin: !!document.querySelector(".ant-spin"),
    })
  `);
  log(`=== Page Content ===\n${bodyInfo}`);

  log(`\nTotal API requests captured: ${allReqs.length}`);
  allReqs.forEach(r => log(`  ${r}`));

  await page.screenshot({ path: "/tmp/apifox-deep-investigation.png", fullPage: true });
  log("Screenshot: /tmp/apifox-deep-investigation.png");

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
