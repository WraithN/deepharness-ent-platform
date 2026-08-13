/**
 * Diagnose Dva store structure: find @@initialState or equivalent model,
 * then test different action types to see which one updates currentUser.
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

  const dump = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return JSON.stringify({ error: "no_fiber" });

      var results = {};

      // Find store via depth 13 fiber
      var walk = function(fiber, depth) {
        if (!fiber || depth > 55) return;
        if (fiber.memoizedProps && fiber.memoizedProps.store && typeof fiber.memoizedProps.store.dispatch === "function") {
          var store = fiber.memoizedProps.store;
          var state = store.getState();
          results.allModelKeys = Object.keys(state);
          
          // Check for @@initialState or login/global/user models
          var iniKeys = results.allModelKeys.filter(function(k) {
            return k.indexOf("initial") >= 0 || k.indexOf("global") >= 0 || k.indexOf("login") >= 0 || k.indexOf("user") >= 0;
          });
          results.matchingModelKeys = iniKeys;

          // Dump each matching model's state
          iniKeys.forEach(function(k) {
            var modelState = state[k];
            if (modelState && typeof modelState === "object") {
              results["model_" + k] = JSON.stringify(modelState).slice(0, 500);
            }
          });

          // Also dump the @@initialState specifically (if exists)
          if (state["@@initialState"]) {
            results["@@initialState_full"] = JSON.stringify(state["@@initialState"]);
          } else {
            results["@@initialState_missing"] = true;
          }

          // Also dump "global" / "app" if they exist
          if (state.global) {
            results.global_full = JSON.stringify(state.global);
          }
          if (state.app) {
            results.app_full = JSON.stringify(state.app);
          }
          if (state.login) {
            results.login_full = JSON.stringify(state.login);
          }
          if (state.user) {
            results.user_full = JSON.stringify(state.user);
          }

          // Try to dispatch to each candidate model
          var fakeUser = { id: 3232299, name: "狐友UgzW", username: "狐友UgzW", userid: "3232299" };
          var candidates = ["@@initialState", "global", "login", "user"];
          candidates.forEach(function(ns) {
            if (state[ns]) {
              try {
                store.dispatch({ type: ns + "/setInitialState", payload: { currentUser: fakeUser } });
                results["dispatch_" + ns + "_setInitialState"] = "ok";
              } catch(e) {
                results["dispatch_" + ns + "_setInitialState"] = "err:" + e.message;
              }
              try {
                store.dispatch({ type: ns + "/save", payload: { currentUser: fakeUser } });
                results["dispatch_" + ns + "_save"] = "ok";
              } catch(e) {
                results["dispatch_" + ns + "_save"] = "err:" + e.message;
              }
              try {
                store.dispatch({ type: ns + "/changeState", payload: { currentUser: fakeUser } });
                results["dispatch_" + ns + "_changeState"] = "ok";
              } catch(e) {
                results["dispatch_" + ns + "_changeState"] = "err:" + e.message;
              }
            }
          });

          // Re-read state after dispatches
          var stateAfter = store.getState();
          ["@@initialState", "global", "login", "user"].forEach(function(ns) {
            if (stateAfter[ns]) {
              results["after_" + ns] = JSON.stringify(stateAfter[ns]).slice(0, 500);
            }
          });

          // Also try: directly mutate the store state at the React fiber level
          var setInitFn = null;
          (function walk2(f, d) {
            if (!f || d > 55 || setInitFn) return;
            var h = f.memoizedState, hi = 0;
            while (h && hi < 30) {
              var v = h.memoizedState;
              if (v && typeof v === "object" && !Array.isArray(v) && v.setInitialState) {
                setInitFn = v.setInitialState;
                results.foundSetInitAt = { depth: d, hookIdx: hi };

                // Call setInitialState AND also use the queue.dispatch
                try {
                  setInitFn({ currentUser: fakeUser, settings: v.initialState.settings });
                  results.setInitDirect = "ok";
                } catch(e) {
                  results.setInitDirect = "err:" + e.message;
                }

                // Also use queue.dispatch directly
                if (h.queue && h.queue.dispatch) {
                  try {
                    h.queue.dispatch({ type: "setInitialState", payload: { currentUser: fakeUser, settings: v.initialState.settings } });
                    results.queueDispatch = "ok";
                  } catch(e) {
                    results.queueDispatch = "err:" + e.message;
                  }
                }
                return;
              }
              h = h.next; hi++;
            }
            walk2(f.child, d + 1);
            walk2(f.sibling, d);
          })(root[rk], 0);

          return;
        }
        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };
      walk(root[rk], 0);

      return JSON.stringify(results, null, 2);
    })()
  `);
  log(`=== Dva Store Diagnosis ===\n${dump}`);

  // Wait for re-render
  await page.waitForTimeout(5000);

  // Check: did any hook state change?
  const hookState = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return "no_fiber";

      var results = [];
      (function walk(f, d) {
        if (!f || d > 55) return;
        var h = f.memoizedState, hi = 0;
        while (h && hi < 30) {
          var v = h.memoizedState;
          if (v && typeof v === "object" && !Array.isArray(v) && ("initialState" in v) && v.initialState && typeof v.initialState === "object") {
            results.push({
              depth: d, hookIdx: hi,
              hasCurrentUser: !!v.initialState.currentUser,
              userName: v.initialState.currentUser ? v.initialState.currentUser.name : null,
              loading: v.loading,
              hasSetInit: !!v.setInitialState,
              settingsKeys: v.initialState.settings ? Object.keys(v.initialState.settings) : null,
            });
          }
          h = h.next; hi++;
        }
        walk(f.child, d + 1);
        walk(f.sibling, d);
      })(root[rk], 0);
      return JSON.stringify(results, null, 2);
    })()
  `);
  log(`=== Hook State After ===\n${hookState}`);

  // Check page content
  const pageState = await page.evaluate(`
    JSON.stringify({
      url: location.href,
      bodySnippet: document.body ? document.body.innerText.slice(0, 300) : "no body",
      hasLogin: (document.body && document.body.innerText || "").indexOf("微信扫码") >= 0,
    })
  `);
  log(`=== Page After ===\n${pageState}`);

  await page.screenshot({ path: "/tmp/apifox-dva-diag.png", fullPage: true });
  log("Screenshot saved");
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
