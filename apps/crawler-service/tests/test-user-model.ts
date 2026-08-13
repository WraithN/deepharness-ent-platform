/**
 * Target the REAL auth models: Dva "user" and "login" (not @@initialState).
 * Find correct reducer/action types to update user.currentUser and login.accessToken.
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
  await page.waitForTimeout(8000);
  log(`URL: ${page.url()}`);

  const result = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return JSON.stringify({ error: "no_fiber" });

      var results = {};
      var FAKE_USER = { id: 3232299, name: "狐友UgzW", username: "狐友UgzW", userid: "3232299", avatar: "" };

      // Find store
      (function walk(fiber, depth) {
        if (!fiber || depth > 55) return;
        if (fiber.memoizedProps && fiber.memoizedProps.store && typeof fiber.memoizedProps.store.dispatch === "function") {
          var store = fiber.memoizedProps.store;
          var stateBefore = store.getState();

          results.userModelBefore = JSON.stringify(stateBefore.user);
          results.loginModelBefore = JSON.stringify(stateBefore.login);

          // === Try EVERY possible action type for user model ===
          var userActions = [
            { type: "user/save", payload: { currentUser: FAKE_USER } },
            { type: "user/save", payload: FAKE_USER },
            { type: "user/update", payload: { currentUser: FAKE_USER } },
            { type: "user/setCurrentUser", payload: FAKE_USER },
            { type: "user/putCurrentUser", payload: FAKE_USER },
            { type: "user/changeCurrentUser", payload: FAKE_USER },
            { type: "user/updateCurrentUser", payload: FAKE_USER },
            { type: "user/querySuccess", payload: FAKE_USER },
            { type: "user/fetchCurrentUser", payload: FAKE_USER },
            { type: "user/getUserInfo/success", payload: FAKE_USER },
            { type: "user/getCurrentUser/success", payload: FAKE_USER },
            // Also try effects (async)
            { type: "user/fetchCurrent", payload: FAKE_USER },
            { type: "user/queryCurrentUser", payload: FAKE_USER },
            { type: "user/updateState", payload: { currentUser: FAKE_USER } },
            { type: "user/replaceState", payload: FAKE_USER },
            // Direct mutation attempts
            { type: "user/__set", payload: { currentUser: FAKE_USER } },
          ];

          results.userDispatchResults = [];
          for (var i = 0; i < userActions.length; i++) {
            var a = userActions[i];
            try {
              store.dispatch(a);
              results.userDispatchResults.push({ type: a.type, status: "ok" });
            } catch(e) {
              results.userDispatchResults.push({ type: a.type, status: "err:" + e.message.slice(0,60) });
            }
          }

          // === Try for login model ===
          var loginActions = [
            { type: "login/save", payload: { accessToken: "FAKE_TOKEN_3232299" } },
            { type: "login/setAccessToken", payload: "FAKE_TOKEN_3232299" },
            { type: "login/updateAccessToken", payload: "FAKE_TOKEN_3232299" },
            { type: "login/changeState", payload: { accessToken: "FAKE_TOKEN_3232299" } },
            { type: "login/saveToken", payload: "FAKE_TOKEN_3232299" },
            { type: "login/putToken", payload: "FAKE_TOKEN_3232299" },
            { type: "login/querySuccess", payload: { accessToken: "FAKE_TOKEN_3232299" } },
            { type: "login/getLoginState/success", payload: { accessToken: "FAKE_TOKEN_3232299" } },
          ];

          results.loginDispatchResults = [];
          for (var j = 0; j < loginActions.length; j++) {
            var b = loginActions[j];
            try {
              store.dispatch(b);
              results.loginDispatchResults.push({ type: b.type, status: "ok" });
            } catch(e) {
              results.loginDispatchResults.push({ type: b.type, status: "err:" + e.message.slice(0,60) });
            }
          }

          // Check state after ALL dispatches
          var stateAfter = store.getState();
          results.userModelAfter = JSON.stringify(stateAfter.user);
          results.loginModelAfter = JSON.stringify(stateAfter.login);
          results.globalModelAfter = JSON.stringify(stateAfter.global);
          results.userDataAfter = JSON.stringify(stateAfter.userData);

          // Did any dispatch work?
          results.userCurrentUserChanged = stateAfter.user && stateAfter.user.currentUser && stateAfter.user.currentUser.id !== 0;
          results.userCurrentUserValue = stateAfter.user && stateAfter.user.currentUser ? JSON.stringify(stateAfter.user.currentUser) : null;
          results.loginAccessToken = stateAfter.login && stateAfter.login.accessToken || "";

          // === Get the user model's reducer names from Dva internals ===
          results.storeKeys = Object.keys(store);
          // Try to find model registry
          if (store._models) {
            results._modelsKeys = Object.keys(store._models);
            results._models_includes_user = !!store._models.find(function(m) { return m.namespace === "user"; });
          }
          if (store.asyncReducers) {
            results.asyncReducers_keys = Object.keys(store.asyncReducers);
          }

          // === Try Dva's own dispatch (might be intercepting) ===
          // Dva wraps dispatch, try the wrapped version
          if (fiber.memoizedProps && fiber.memoizedProps.dvaApp) {
            results.hasDvaApp = true;
          }

          // Try dispatch via fiber.stateNode (class component with dispatch prop)
          if (fiber.stateNode && fiber.stateNode.props && fiber.stateNode.props.dispatch) {
            results.hasStateNodeDispatch = true;
            try {
              fiber.stateNode.props.dispatch({ type: "user/save", payload: { currentUser: FAKE_USER } });
              results.stateNodeDispatchUser = "ok";
            } catch(e) {
              results.stateNodeDispatchUser = "err:" + e.message;
            }
          }

          // Check state AFTER stateNode.dispatch
          var stateAfter2 = store.getState();
          results.userModelAfterStateNode = JSON.stringify(stateAfter2.user);

          return;
        }
        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      })(root[rk], 0);

      return JSON.stringify(results, null, 2);
    })()
  `);
  log(`=== User/Login Model Probe ===\n${result}`);

  // Wait and check page state
  await page.waitForTimeout(3000);
  const pageState = await page.evaluate(`
    JSON.stringify({
      url: location.href,
      bodySnippet: document.body ? document.body.innerText.slice(0, 300) : "no body",
      hasLogin: (document.body && document.body.innerText || "").indexOf("微信扫码") >= 0,
    })
  `);
  log(`Page after: ${pageState}`);

  await page.screenshot({ path: "/tmp/apifox-user-model.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
