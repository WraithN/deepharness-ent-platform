/**
 * Precision test: call setInitialState on the @@initialState hook,
 * wait for React to re-render, then re-read the hook.
 * Also tries direct Dva dispatch if store is accessible.
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
      history.pushState = function(s,t,u) { if(String(u).includes("/user/login")) return; return op.apply(this,arguments); };
      var or_ = history.replaceState;
      history.replaceState = function(s,t,u) { if(String(u).includes("/user/login")) return; return or_.apply(this,arguments); };
      // Intercept fetch to mock user API responses and prevent redirect logic
      var _fetch = window.fetch;
      window.fetch = function(url, opts) {
        if (typeof url === "string") {
          // Log for debugging
          console.log("[fetch-hook]", url.slice(0, 120));
        }
        return _fetch.apply(this, arguments);
      };
    })()
  `);

  const page = await ctx.newPage();

  // Also intercept at network level: mock any /user or /current API calls
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    // Match user/self/current related APIs
    const userApiPatterns = [
      "/api/v1/users/current", "/api/v1/user/current", "/api/v1/self",
      "/api/v1/account", "/api/v1/currentUser",
      "/api/v1/user", "/api/v1/users/",
    ];
    const isUserApi = userApiPatterns.some(p => url.includes(p));
    if (isUserApi) {
      log(`[ROUTE-MOCK] ${route.request().method()} ${url.slice(0,150)}`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            id: 3232299, name: "狐友UgzW", username: "狐友UgzW",
            userid: "3232299", avatar: null,
          }
        }),
      });
      return;
    }
    // Continue for everything else
    try { await route.continue(); } catch { /* ignore */ }
  });

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });
  log(`URL: ${page.url()}`);

  // Wait for React to fully render
  await page.waitForTimeout(6000);
  log(`After 6s: ${page.url()}`);

  // ====== Step 1: Read the hook BEFORE injection ======
  const before = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return JSON.stringify({ error: "no_fiber" });

      var results = [];
      var walk = function(fiber, depth) {
        if (!fiber || depth > 55) return;
        var hook = fiber.memoizedState;
        var hi = 0;
        while (hook && hi < 30) {
          var v = hook.memoizedState;
          if (v && typeof v === "object" && v !== null && !Array.isArray(v)) {
            if ("initialState" in v && "setInitialState" in v && "loading" in v) {
              results.push({
                depth: depth, hookIdx: hi,
                loading: v.loading,
                initialStateStr: JSON.stringify(v.initialState),
                hasCurrentUser: !!(v.initialState && v.initialState.currentUser),
                setInitType: typeof v.setInitialState,
                refreshType: typeof v.refresh,
              });
            }
          }
          hook = hook.next;
          hi++;
        }
        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };
      try { walk(root[rk], 0); } catch(e) { return JSON.stringify({ error: "walk_err:" + e.message }); }
      return JSON.stringify(results);
    })()
  `);
  log(`=== BEFORE injection ===\n${before}`);

  // ====== Step 2: Call setInitialState + inspect hook queue for dispatch ======
  const injectResult = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return JSON.stringify({ error: "no_fiber" });

      var results = [];
      var walk = function(fiber, depth) {
        if (!fiber || depth > 55) return;
        var hook = fiber.memoizedState;
        var hi = 0;
        while (hook && hi < 30) {
          var v = hook.memoizedState;
          if (v && typeof v === "object" && v !== null && !Array.isArray(v)) {
            if ("initialState" in v && "setInitialState" in v && "loading" in v) {
              var fakeUser = { id: 3232299, name: "狐友UgzW", username: "狐友UgzW", userid: "3232299" };
              var settings = v.initialState && v.initialState.settings || {};
              var newState = { currentUser: fakeUser, settings: settings };

              // Call setInitialState
              if (typeof v.setInitialState === "function") {
                try {
                  v.setInitialState(newState);
                  results.push({ action: "called_setInitialState", payload: JSON.stringify(newState).slice(0,200) });
                } catch(e) {
                  results.push({ action: "setInit_error", error: e.message });
                }
              } else {
                results.push({ action: "setInit_not_function", type: typeof v.setInitialState });
              }

              // Also try refresh
              if (typeof v.refresh === "function") {
                try {
                  // Don't call refresh yet - it may redirect
                  results.push({ action: "refresh_available" });
                } catch(e) {}
              }

              // Inspect hook.queue for dispatch/store reference
              if (hook.queue) {
                var qkeys = Object.keys(hook.queue);
                results.push({ action: "queue_keys", keys: qkeys });
                if (hook.queue.dispatch) {
                  results.push({ action: "queue_has_dispatch" });
                  // Try to dispatch directly!
                  try {
                    hook.queue.dispatch({ type: "@@initialState/setInitialState", payload: newState });
                    results.push({ action: "direct_dispatch_called" });
                  } catch(e) {
                    results.push({ action: "dispatch_error", error: e.message });
                  }
                }
              }

              // Inspect NEXT hooks for store references
              var nextHook = hook.next;
              var nhi = hi + 1;
              while (nextHook && nhi < hi + 10) {
                var nv = nextHook.memoizedState;
                if (Array.isArray(nv) && nv.length === 2) {
                  var mv = nv[0];
                  if (mv && typeof mv === "object") {
                    var mkeys = Object.keys(mv).slice(0, 15);
                    if (mkeys.indexOf("dispatch") >= 0 || mkeys.indexOf("store") >= 0 || mkeys.indexOf("getState") >= 0) {
                      results.push({ action: "next_hook_has_store", offset: nhi - hi, keys: mkeys });
                    }
                  }
                }
                if (nv && typeof nv === "object" && !Array.isArray(nv)) {
                  var keys = Object.keys(nv).slice(0, 10);
                  if (keys.indexOf("dispatch") >= 0 || keys.indexOf("store") >= 0) {
                    results.push({ action: "next_hook_has_store_direct", offset: nhi - hi, keys: keys });
                  }
                }
                nextHook = nextHook.next;
                nhi++;
              }
            }
          }
          hook = hook.next;
          hi++;
        }
        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };
      try { walk(root[rk], 0); } catch(e) { return JSON.stringify({ error: "walk_err:" + e.message }); }
      return JSON.stringify(results);
    })()
  `);
  log(`=== INJECTION ===\n${injectResult}`);

  // ====== Step 3: Wait for React re-render ======
  log("Waiting for re-render...");
  await page.waitForTimeout(3000);

  // ====== Step 4: Re-read the hook ======
  const after = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return JSON.stringify({ error: "no_fiber" });

      var results = [];
      var walk = function(fiber, depth) {
        if (!fiber || depth > 55) return;
        var hook = fiber.memoizedState;
        var hi = 0;
        while (hook && hi < 30) {
          var v = hook.memoizedState;
          if (v && typeof v === "object" && v !== null && !Array.isArray(v)) {
            if ("initialState" in v && "setInitialState" in v && "loading" in v) {
              results.push({
                depth: depth, hookIdx: hi,
                loading: v.loading,
                initialStateStr: JSON.stringify(v.initialState),
                hasCurrentUser: !!(v.initialState && v.initialState.currentUser),
              });
            }
          }
          hook = hook.next;
          hi++;
        }
        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };
      try { walk(root[rk], 0); } catch(e) { return JSON.stringify({ error: "walk_err:" + e.message }); }
      return JSON.stringify(results);
    })()
  `);
  log(`=== AFTER injection (3s wait) ===\n${after}`);

  // ====== Step 5: Check URL and page content ======
  const finalCheck = await page.evaluate(`
    JSON.stringify({
      url: location.href,
      title: document.title,
      bodySnippet: (document.body?.innerText || "").slice(0, 200),
      loginVisible: !!(document.body?.innerText || "").includes("微信扫码"),
      hasDashboard: !!(document.body?.innerText || "").includes("项目"),
    })
  `);
  log(`=== Final State ===\n${finalCheck}`);

  await page.screenshot({ path: "/tmp/apifox-setInit-test.png", fullPage: true });
  log("Screenshot saved");

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
