/**
 * Test: Inject auth into Apifox via React fiber tree manipulation (raw string approach).
 * Steps:
 * 1. Navigate to the login page
 * 2. Dump the fiber tree to find useModel('@@initialState') hooks
 * 3. Call setInitialState with mock user data
 * 4. Verify the state was updated
 */
import { chromium } from "playwright";

const APIFOX_URL = "http://localhost:47823";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("[step1] Navigating...");
  await page.goto(APIFOX_URL, { waitUntil: "networkidle" });
  console.log("[step1] Done. Waiting for React render...");
  await page.waitForTimeout(3000);

  const mockUser = {
    id: "test-user-001",
    username: "injected_user@apifox.com",
    name: "Injected User",
    email: "injected@apifox.com",
    avatar: "",
    role: "admin",
  };

  const userJSON = JSON.stringify(mockUser);

  // Step 2: Walk the fiber tree to find useModel('@@initialState') hooks
  // In UMI, hooks are stored as fiber.memoizedState -> next -> next (linked list)
  // Each hook has:
  //   hook.queue  -> update queue (for useState/useReducer)
  //   hook.memoizedState -> current value

  const step2 = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      if (!root) return JSON.stringify({error: "no_root"});

      var rk = null;
      var keys = Object.keys(root);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf("__react") === 0) { rk = keys[i]; break; }
      }
      if (!rk) return JSON.stringify({error: "no_fiber_key"});

      var matches = [];
      var walk = function(fiber, depth) {
        if (!fiber || depth > 50 || matches.length > 30) return;

        // Check hooks on this fiber's stateNode (for function components)
        if (fiber.memoizedState) {
          var hook = fiber.memoizedState;
          var idx = 0;
          while (hook && idx < 20) {
            // hook.memoizedState is the hook's current value
            var v = hook.memoizedState;
            if (v && typeof v === "object" && v.initialState !== undefined && v.setInitialState !== undefined) {
              var keys = [];
              try { keys = Object.keys(v); } catch(e) {}
              matches.push({
                depth: depth,
                hookIdx: idx,
                tag: fiber.tag,
                keys: keys,
                loading: v.loading,
                hasCurrentUser: v.initialState && v.initialState.currentUser ? true : false,
              });
            }
            hook = hook.next;
            idx++;
          }
        }

        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };

      try { walk(root[rk], 0); } catch(e) { return JSON.stringify({error: "walk_err:" + e.message}); }
      return JSON.stringify({matches: matches});
    })()
  `);

  console.log(`[step2] Hook matches: ${step2}`);

  // Step 3: Call setInitialState on the found hooks
  const step3 = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      if (!root) return JSON.stringify({error: "no_root"});
      var rk = null;
      var keys = Object.keys(root);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf("__react") === 0) { rk = keys[i]; break; }
      }
      if (!rk) return JSON.stringify({error: "no_fiber_key"});

      var results = [];
      var walk = function(fiber, depth) {
        if (!fiber || depth > 50) return;

        if (fiber.memoizedState) {
          var hook = fiber.memoizedState;
          var idx = 0;
          while (hook && idx < 20) {
            var v = hook.memoizedState;
            if (v && typeof v === "object" && typeof v.setInitialState === "function" && v.initialState !== undefined) {
              try {
                var user = ${userJSON};
                // Also include settings from existing state
                var existingSettings = v.initialState && v.initialState.settings ? v.initialState.settings : {};
                var newState = { currentUser: user, settings: existingSettings };
                v.setInitialState(newState);
                results.push({depth: depth, hookIdx: idx, called: true, prevLoading: v.loading});
              } catch(e) {
                results.push({depth: depth, hookIdx: idx, error: e.message});
              }
            }
            hook = hook.next;
            idx++;
          }
        }

        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };

      try { walk(root[rk], 0); } catch(e) { return JSON.stringify({error: "walk_err2:" + e.message}); }
      return JSON.stringify({results: results});
    })()
  `);

  console.log(`[step3] setInitialState results: ${step3}`);

  // Step 4: Wait for React to process and re-check
  await page.waitForTimeout(2000);

  const step4 = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      if (!root) return JSON.stringify({error: "no_root"});
      var rk = null;
      var keys = Object.keys(root);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf("__react") === 0) { rk = keys[i]; break; }
      }
      if (!rk) return JSON.stringify({error: "no_fiber_key"});

      var matches = [];
      var walk = function(fiber, depth) {
        if (!fiber || depth > 50 || matches.length > 30) return;

        if (fiber.memoizedState) {
          var hook = fiber.memoizedState;
          var idx = 0;
          while (hook && idx < 20) {
            var v = hook.memoizedState;
            if (v && typeof v === "object" && v.initialState !== undefined) {
              var keys = [];
              try { keys = Object.keys(v); } catch(e) {}
              var isKeys = v.initialState ? Object.keys(v.initialState) : [];
              matches.push({
                depth: depth, hookIdx: idx,
                keys: keys,
                loading: v.loading,
                isKeys: isKeys,
                hasCurrentUser: v.initialState && v.initialState.currentUser ? true : false,
              });
            }
            hook = hook.next;
            idx++;
          }
        }

        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };

      try { walk(root[rk], 0); } catch(e) { return JSON.stringify({error: "walk_err3:" + e.message}); }
      return JSON.stringify({matches: matches});
    })()
  `);

  console.log(`[step4] After setInitialState: ${step4}`);

  // Interact: try clicking a button or checking if page redirected
  await page.waitForTimeout(2000);
  const currentUrl = page.url();
  console.log(`[final] Current URL: ${currentUrl}`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
