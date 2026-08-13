/**
 * After confirming setInitialState works locally but consumers don't re-render,
 * we need to find and dispatch to the DVA STORE, not just the local hook.
 * Walk UP from the @@initialState hook to find a parent fiber with store reference.
 * Also try to access the store via React internals.
 */
import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];
const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";

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
      history.pushState = function(s,t,u) { if (String(u).includes("/user/login")) return; return op.apply(this,arguments); };
      var or_ = history.replaceState;
      history.replaceState = function(s,t,u) { if (String(u).includes("/user/login")) return; return or_.apply(this,arguments); };
    })()
  `);

  const page = await ctx.newPage();

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);
  log(`URL: ${page.url()}`);

  // ==== Find the Dva store by walking UP from the @@initialState hook ====
  const storeHunt = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) {
        return k.startsWith("__reactFiber") || k.startsWith("__reactContainer");
      });
      if (!rk) return JSON.stringify({ error: "no_fiber" });

      var results = [];

      // Find the @@initialState provider hook
      var targetFiber = null;
      var walk = function(fiber, depth) {
        if (!fiber || depth > 55 || targetFiber) return;
        var hook = fiber.memoizedState;
        var hi = 0;
        while (hook && hi < 30) {
          var v = hook.memoizedState;
          if (v && typeof v === "object" && v !== null && !Array.isArray(v)) {
            if ("initialState" in v && "setInitialState" in v && "loading" in v) {
              targetFiber = fiber;
              return;
            }
          }
          hook = hook.next;
          hi++;
        }
        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };
      walk(root[rk], 0);

      if (!targetFiber) return JSON.stringify({ error: "target_not_found" });

      // Walk UP from targetFiber searching for store
      var fiber = targetFiber;
      var upDepth = 0;
      while (fiber && upDepth < 20) {
        try {
          // Check memoizedProps for store-like properties
          var props = fiber.memoizedProps;
          if (props && typeof props === "object") {
            var pkeys = Object.keys(props);
            var storeKeys = pkeys.filter(function(k) {
              return k.toLowerCase().indexOf("store") >= 0 || k === "app";
            });
            if (storeKeys.length > 0) {
              var storeVal = props[storeKeys[0]];
              var storeValType = typeof storeVal;
              var storeValKeys = (storeVal && typeof storeVal === "object")
                ? Object.keys(storeVal).slice(0, 15) : null;
              results.push({
                direction: "UP",
                offset: upDepth,
                fiberTag: fiber.tag,
                fiberType: fiber.elementType,
                hasStoreInProps: storeKeys,
                storeValType: storeValType,
                storeValKeys: storeValKeys,
                hasDispatch: storeVal && typeof storeVal.dispatch === "function",
                hasGetState: storeVal && typeof storeVal.getState === "function",
                has_model: storeVal && !!storeVal._model,
              });

              // If found the store, try to dispatch
              if (storeVal && typeof storeVal.dispatch === "function") {
                results.push({ action: "FOUND_DVA_STORE", dispatchType: typeof storeVal.dispatch, getStateType: typeof storeVal.getState });
                // Try to dispatch!
                try {
                  var newState = {
                    currentUser: { id: 3232299, name: "狐友UgzW", username: "狐友UgzW", userid: "3232299" },
                    settings: { navTheme: "light", primaryColor: "#1890ff", layout: "top", contentWidth: "Fluid", fixedHeader: false, fixSiderbar: true, colorWeak: false, pwa: false, iconfontUrl: "", responseValidate: true }
                  };
                  storeVal.dispatch({ type: "@@initialState/setInitialState", payload: newState });
                  results.push({ action: "DVA_DISPATCH_CALLED" });
                } catch(e) {
                  results.push({ action: "DVA_DISPATCH_ERROR", error: e.message });
                }
              }
            }
          }

          // Check stateNode for store
          if (fiber.stateNode && typeof fiber.stateNode === "object") {
            var sn = fiber.stateNode;
            var snKeys = Object.keys(sn).filter(function(k) {
              return k.toLowerCase().indexOf("store") >= 0 || k === "app" || k === "_dispatch";
            });
            if (snKeys.length > 0) {
              results.push({
                direction: "UP",
                offset: upDepth,
                source: "stateNode",
                keys: snKeys,
              });
            }

            // Check _reactInternals or __reactFiber pattern
            for (var sk in sn) {
              if (sk.startsWith("__react") || sk.startsWith("_react")) {
                try {
                  var inner = sn[sk];
                  if (inner && typeof inner === "object") {
                    results.push({ direction: "UP", offset: upDepth, source: "stateNode." + sk, keys: Object.keys(inner).slice(0, 10) });
                  }
                } catch(e) {}
              }
            }
          }

          // Check fiber.dependencies for context values with store
          if (fiber.dependencies) {
            var deps = fiber.dependencies;
            try {
              if (deps && deps.firstContext) {
                var ctx = deps.firstContext;
                if (ctx) {
                  results.push({ direction: "UP", offset: upDepth, hasContextDeps: true });
                }
              }
            } catch(e) {}
          }
        } catch(e) {
          results.push({ direction: "UP", offset: upDepth, error: e.message });
        }
        fiber = fiber.return;
        upDepth++;
      }

      return JSON.stringify(results, null, 2);
    })()
  `);
  log(`=== Store Hunt (walk UP) ===\n${storeHunt}`);

  // ==== Also scan all fibers for memoizedProps with "store" or "dispatch" ====
  const wideScan = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) {
        return k.startsWith("__reactFiber") || k.startsWith("__reactContainer");
      });
      if (!rk) return JSON.stringify({ error: "no_fiber" });

      var candidates = [];
      var walk = function(fiber, depth) {
        if (!fiber || depth > 55) return;
        try {
          var props = fiber.memoizedProps;
          if (props && typeof props === "object" && props !== null) {
            for (var k in props) {
              var v = props[k];
              if (!v || typeof v !== "object") continue;
              // Check for store-like objects
              if (typeof v.dispatch === "function" || typeof v.getState === "function" || typeof v._store === "object") {
                var vkeys = Object.keys(v).slice(0, 15);
                candidates.push({
                  depth: depth,
                  propKey: k,
                  tag: fiber.tag,
                  dispatchType: typeof v.dispatch,
                  getStateType: typeof v.getState,
                  subscribeType: typeof v.subscribe,
                  keys: vkeys,
                });
              }
            }
          }

          // Also check stateNode
          var sn = fiber.stateNode;
          if (sn && typeof sn === "object") {
            for (var sk in sn) {
              var sv = sn[sk];
              if (sv && typeof sv === "object" && (typeof sv.dispatch === "function" || typeof sv.getState === "function")) {
                candidates.push({
                  depth: depth,
                  source: "stateNode." + sk,
                  dispatchType: typeof sv.dispatch,
                  getStateType: typeof sv.getState,
                  keys: Object.keys(sv).slice(0, 15),
                });
              }
            }
          }
        } catch(e) {}

        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };
      walk(root[rk], 0);
      return JSON.stringify(candidates, null, 2);
    })()
  `);
  log(`=== Wide Store Scan ===\n${wideScan}`);

  // ==== Try to access store via React Fiber root (containerInfo) ====
  const reactRoot = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var results = {};
      for (var k in root) {
        if (k.startsWith("__reactContainer")) {
          var fiber = root[k];
          results.containerFiberTag = fiber.tag;
          results.containerFiberType = typeof fiber.stateNode;

          // Check fiberRoot or containerInfo for store
          if (fiber.stateNode) {
            var snKeys = Object.keys(fiber.stateNode).slice(0, 20);
            results.stateNodeKeys = snKeys;

            var sn = fiber.stateNode;
            // _reactRootContainer or similar
            for (var sk in sn) {
              if (sk.startsWith("_react") || sk.startsWith("__react") || sk.indexOf("root") >= 0) {
                try {
                  results["stateNode." + sk + "_type"] = typeof sn[sk];
                  if (sn[sk] && typeof sn[sk] === "object") {
                    results["stateNode." + sk + "_keys"] = Object.keys(sn[sk]).slice(0, 15);
                  }
                } catch(e) {}
              }
            }
          }
        }
      }
      return JSON.stringify(results, null, 2);
    })()
  `);
  log(`=== React Root Analysis ===\n${reactRoot}`);

  await page.screenshot({ path: "/tmp/apifox-store-hunt.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
