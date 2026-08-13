/**
 * Brute-force approach:
 * 1. Directly mutate Dva store state (user.currentUser, login.accessToken)
 * 2. Update @@initialState hook via setInitialState
 * 3. Dispatch dummy action to trigger Redux subscribers
 * 4. Trigger React re-render by updating root fiber
 * 5. Verify page shows dashboard instead of login
 */
import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];
const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";
const FAKE_USER_ID = 3232299;

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
  await page.waitForTimeout(8000);
  log(`URL: ${page.url()}`);

  const result = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return JSON.stringify({ error: "no_fiber" });

      var results = {};
      var FAKE_USER = { id: ${FAKE_USER_ID}, name: "狐友UgzW", username: "狐友UgzW", userid: "${FAKE_USER_ID}", avatar: "" };
      var FAKE_SETTINGS = { navTheme: "light", primaryColor: "#1890ff", layout: "top", contentWidth: "Fluid", fixedHeader: false, fixSiderbar: true, colorWeak: false, pwa: false, iconfontUrl: "", responseValidate: true };

      // ===== Step 1: Find store and directly mutate state =====
      var store = null;
      var storeFiber = null;
      (function walk(f, d) {
        if (!f || d > 55 || store) return;
        if (f.memoizedProps && f.memoizedProps.store && typeof f.memoizedProps.store.dispatch === "function") {
          store = f.memoizedProps.store;
          storeFiber = f;
          return;
        }
        walk(f.child, d + 1);
        walk(f.sibling, d);
      })(root[rk], 0);

      if (!store) return JSON.stringify({ error: "no_store" });

      var state = store.getState();
      results.userBefore = JSON.stringify(state.user);
      results.loginBefore = JSON.stringify(state.login);

      // DIRECTLY mutate the store's internal state
      state.user.currentUser = FAKE_USER;
      state.login.accessToken = "FAKE_TOKEN_" + ${FAKE_USER_ID};

      results.userAfterMutate = JSON.stringify(state.user);
      results.loginAfterMutate = JSON.stringify(state.login);

      // ===== Step 2: Update @@initialState hook =====
      var setInitFn = null;
      var queueDispatch = null;
      (function walk(f, d) {
        if (!f || d > 55 || setInitFn) return;
        var h = f.memoizedState, hi = 0;
        while (h && hi < 30) {
          var v = h.memoizedState;
          if (v && typeof v === "object" && !Array.isArray(v) && v.setInitialState) {
            setInitFn = v.setInitialState;
            if (h.queue && h.queue.dispatch) queueDispatch = h.queue.dispatch;
            try {
              setInitFn({ currentUser: FAKE_USER, settings: FAKE_SETTINGS });
              results.setInitCalled = "ok";
            } catch(e) {
              results.setInitCalled = "err:" + e.message;
            }
            return;
          }
          h = h.next; hi++;
        }
        walk(f.child, d + 1);
        walk(f.sibling, d);
      })(root[rk], 0);

      // ===== Step 3: Dispatch dummy action to trigger Redux subscribers =====
      try { store.dispatch({ type: "@@dva/INIT" }); results.dvaInit = "ok"; } catch(e) { results.dvaInit = "err:" + e.message; }
      try { store.dispatch({ type: "@@dva/REFRESH" }); results.dvaRefresh = "ok"; } catch(e) { results.dvaRefresh = "err:" + e.message; }

      // ===== Step 4: Force React re-render by scheduling update on root =====
      // Access React's internal scheduler and force an update
      // React 18+ uses lanes scheduling. We can call root.enqueueUpdate
      // or just dispatch an action through any connected component.
      
      // Try: use the store's subscribe to trigger a state re-read
      store.dispatch({ type: "global/save", payload: { collapsed: false } }); // dummy safe dispatch

      // Try react-dom internals
      try {
        if (window.ReactDOM && window.ReactDOM.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) {
          results.reactInternals = "available";
          window.ReactDOM.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactDOMSharedInternals.d('__forceUpdate');
        }
      } catch(e) {
        results.reactInternalsError = e.message.slice(0, 80);
      }

      // Try root fiber forceUpdate
      try {
        var containerFiber = root[rk];
        if (containerFiber.tag === 3) { // FiberRoot
          // Force synchronous re-render
          // React 18: use root._internalRoot or containerFiber itself
          results.rootTag = containerFiber.tag;
          
          // Try to enqueue a force update
          if (typeof containerFiber.pendingContext !== "undefined") {
            containerFiber.pendingContext = true;
          }
          // Dispatch a high-priority update
          try {
            // Access React's scheduler
            var ReactDOM = window.ReactDOM;
            if (ReactDOM) {
              // Force re-render by dispatching to a fiber's queue
              if (storeFiber) {
                // Update the store provider fiber
                storeFiber.updateQueue = storeFiber.updateQueue || {};
              }
            }
          } catch(e) {
            results.forceUpdateError = e.message.slice(0, 80);
          }
        }
        results.forceUpdate = "attempted";
      } catch(e) {
        results.forceUpdateError = e.message.slice(0, 80);
      }

      // ===== Step 5: Verify immediate state =====
      var state2 = store.getState();
      results.userAfterAll = JSON.stringify(state2.user);
      results.loginAfterAll = JSON.stringify(state2.login);

      return JSON.stringify(results);
    })()
  `);
  log(`=== Brute Force Injection ===\n${result}`);

  // Wait for React to re-render
  await page.waitForTimeout(5000);

  // Check final page state
  const final = await page.evaluate(`
    JSON.stringify({
      url: location.href,
      title: document.title,
      bodySnippet: document.body ? document.body.innerText.slice(0, 400) : "no body",
      hasWeChatLogin: (document.body && document.body.innerText || "").indexOf("微信扫码") >= 0,
      bodyLength: (document.body && document.body.innerText) ? document.body.innerText.length : 0,
      // Check for dashboard elements
      hasProjectText: (document.body && document.body.innerText || "").indexOf("项目") >= 0,
      hasTeamText: (document.body && document.body.innerText || "").indexOf("团队") >= 0,
    })
  `);
  log(`=== Final Page State ===\n${final}`);

  // Also check Dva state from fiber
  const dvaAfter = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return "no_fiber";
      var result = {};
      (function walk(f, d) {
        if (!f || d > 55) return;
        if (f.memoizedProps && f.memoizedProps.store && typeof f.memoizedProps.store.dispatch === "function") {
          var s = f.memoizedProps.store;
          var st = s.getState();
          result.userCurrentUser = JSON.stringify(st.user.currentUser);
          result.loginAccessToken = st.login.accessToken;
          result.routing = JSON.stringify(st.routing);
          return;
        }
        walk(f.child, d + 1);
        walk(f.sibling, d);
      })(root[rk], 0);
      return JSON.stringify(result);
    })()
  `);
  log(`=== Dva State After Wait ===\n${dvaAfter}`);

  // Check hook state after
  const hookState = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return "no_fiber";
      var result = [];
      (function walk(f, d) {
        if (!f || d > 55) return;
        var h = f.memoizedState, hi = 0;
        while (h && hi < 30) {
          var v = h.memoizedState;
          if (v && typeof v === "object" && !Array.isArray(v) && ("initialState" in v)) {
            result.push({
              depth: d, hookIdx: hi,
              hasCurrentUser: v.initialState && !!v.initialState.currentUser,
              loading: v.loading,
            });
          }
          h = h.next; hi++;
        }
        walk(f.child, d + 1);
        walk(f.sibling, d);
      })(root[rk], 0);
      return JSON.stringify(result);
    })()
  `);
  log(`=== Hook State After ===\n${hookState}`);

  await page.screenshot({ path: "/tmp/apifox-brute-force.png", fullPage: true });
  log("Screenshot saved");
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
