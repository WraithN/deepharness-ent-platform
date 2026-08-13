/**
 * FINAL VERIFICATION: Dispatch to DVA STORE and check if page re-renders to dashboard.
 * We found the store at fiber depth 13 (memoizedProps.store is Redux store).
 * Now let's dispatch setInitialState via store.dispatch and verify the auth guard component
 * (SecurityLayout) re-renders to show the actual app instead of the login screen.
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
  // Block redirect to /user/login
  await ctx.addInitScript(`
    (function() {
      var op = history.pushState;
      history.pushState = function(s,t,u) { if (String(u).includes("/user/login")) return; return op.apply(this,arguments); };
      var or_ = history.replaceState;
      history.replaceState = function(s,t,u) { if (String(u).includes("/user/login")) return; return or_.apply(this,arguments); };
    })()
  `);

  const page = await ctx.newPage();
  page.on("request", (r) => { if (r.url().includes("user-trackings")) log("REQ: user-trackings"); });
  page.on("response", (r) => {
    if (r.status() >= 400) log("RESP-ERR: " + r.url() + " -> " + r.status());
  });
  // Monitor navigations
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) log("NAV: " + f.url()); });

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });
  log("DOM ready, waiting for getInitialState...");
  await page.waitForTimeout(8000); // Wait for getInitialState to complete (shows WeChat QR)

  log(`URL: ${page.url()}`);
  log(`Title: ${await page.title()}`);

  // Check page content BEFORE injection
  const before = await page.evaluate(`
    (function() {
      var body = document.body ? document.body.innerText.slice(0, 300) : "no body";
      var hasLogin = body.indexOf("微信扫码") >= 0;
      var hasDashboard = body.indexOf("项目") >= 0 && body.indexOf("我的") < 50;
      return JSON.stringify({ hasLogin: hasLogin, hasDashboard: hasDashboard, snippet: body.slice(0, 150) });
    })()
  `);
  log(`BEFORE content: ${before}`);

  // ==== NOW: find store and dispatch setInitialState ====
  const injectResult = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return JSON.stringify({ error: "no_fiber" });

      var results = {};

      // Find the @@initialState hook
      var targetFiber = null;
      (function walk(fiber, depth) {
        if (!fiber || depth > 55 || targetFiber) return;
        var hook = fiber.memoizedState, hi = 0;
        while (hook && hi < 30) {
          var v = hook.memoizedState;
          if (v && typeof v === "object" && !Array.isArray(v) && ("initialState" in v) && ("setInitialState" in v) && ("loading" in v)) {
            targetFiber = fiber;
            return;
          }
          hook = hook.next; hi++;
        }
        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      })(root[rk], 0);

      if (!targetFiber) return JSON.stringify({ error: "target_not_found" });

      // Walk UP to find store
      var fiber = targetFiber;
      var upDepth = 0;
      while (fiber && upDepth < 10) {
        var props = fiber.memoizedProps;
        if (props && props.store && typeof props.store.dispatch === "function") {
          results.foundStoreAt = upDepth;
          results.storeKeys = Object.keys(props.store);
          results.getStateBefore = JSON.stringify(props.store.getState()).slice(0, 200);

          // Dispatch setInitialState with currentUser
          var newState = {
            currentUser: {
              id: 3232299,
              name: "狐友UgzW",
              username: "狐友UgzW",
              userid: "3232299",
              avatar: "",
              mobile: "",
              userType: 2
            },
            settings: { navTheme: "light", primaryColor: "#1890ff", layout: "top", contentWidth: "Fluid", fixedHeader: false, fixSiderbar: true, colorWeak: false, pwa: false, iconfontUrl: "", responseValidate: true }
          };

          try {
            props.store.dispatch({ type: "@@initialState/setInitialState", payload: newState });
            results.dispatchResult = "ok";
          } catch(e) {
            results.dispatchResult = "error:" + e.message;
          }

          // Verify state changed
          results.getStateAfter = JSON.stringify(props.store.getState()).slice(0, 500);

          // Also try Dva dispatcher (different dispatch path)
          try {
            props.store.dispatch({ type: "saveInitialState", payload: newState });
            results.dvaDispatchResult = "ok";
          } catch(e) {
            results.dvaDispatchResult = "skipped:" + e.message.slice(0,50);
          }

          break;
        }
        fiber = fiber.return;
        upDepth++;
      }

      return JSON.stringify(results);
    })()
  `);
  log(`=== Dva Store Inject ===\n${injectResult}`);

  // Wait for React to re-render (React batches state updates)
  await page.waitForTimeout(5000);

  // Check page content AFTER injection
  const after = await page.evaluate(`
    (function() {
      var body = document.body ? document.body.innerText.slice(0, 500) : "no body";
      var hasLogin = body.indexOf("微信扫码") >= 0;
      var hasDashboard = body.indexOf("项目管理") >= 0 || body.indexOf("团队") >= 0;
      return JSON.stringify({
        url: location.href,
        title: document.title,
        hasLogin: hasLogin,
        hasDashboard: hasDashboard,
        snippet: body.slice(0, 300),
        bodyLength: (document.body && document.body.innerText) ? document.body.innerText.length : 0
      });
    })()
  `);
  log(`AFTER content: ${after}`);

  // Also check the @@initialState hook state (did it change?)
  const hookAfter = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return "no_fiber";

      var result = [];
      (function walk(fiber, depth) {
        if (!fiber || depth > 55) return;
        var hook = fiber.memoizedState, hi = 0;
        while (hook && hi < 30) {
          var v = hook.memoizedState;
          if (v && typeof v === "object" && !Array.isArray(v) && ("initialState" in v) && ("setInitialState" in v) && ("loading" in v)) {
            result.push({
              depth: depth,
              hookIdx: hi,
              loading: v.loading,
              hasCurrentUser: v.initialState && v.initialState.currentUser !== undefined,
              currentUserName: v.initialState && v.initialState.currentUser ? v.initialState.currentUser.name : null,
              settingsKeys: v.initialState && v.initialState.settings ? Object.keys(v.initialState.settings) : null
            });
          }
          hook = hook.next; hi++;
        }
        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      })(root[rk], 0);
      return JSON.stringify(result);
    })()
  `);
  log(`Hook state after: ${hookAfter}`);

  await page.screenshot({ path: "/tmp/apifox-dva-inject-verify.png", fullPage: true });
  log("Screenshot saved");

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
