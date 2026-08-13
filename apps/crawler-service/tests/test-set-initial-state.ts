/**
 * Test: find UMI @@initialState model hook in React fiber tree,
 * call setInitialState() with user data to trigger layout re-render.
 *
 * This solves the root cause: UMI plugin-model uses hooks (not Redux),
 * so we MUST call setInitialState() on the fiber to populate the context.
 *
 * Usage: npx tsx src/test-set-initial-state.ts
 */

import { chromium } from "playwright";

const TARGET_URL = "https://app.apifox.com/main/teams/3883284?tab=project";
const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";

const USER = {
  id: 3232299, name: "狐友UgzW",
  avatar: "https://cdn.apifox.com/app/avatar/builtin/19.png",
  username: "狐友UgzW", employeeNumber: null, email: null,
  hasPassword: false, bio: "", mobile: null,
  createdAt: "2025-10-14T02:34:22.000Z", updatedAt: "2025-10-14T02:34:22.000Z",
  deletedAt: null, features: {}, unreadCount: 0,
};

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  log("Launching browser...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  const page = await ctx.newPage();

  log("Navigating to " + TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for Dva store to be created (but before getInitialState completes!)
  await page.waitForFunction(() => !!(window as any).__dva_store__, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500); // Very short wait — catch it while loading: true

  // SCRIPT: find the @@initialState model hook and call setInitialState
  // Use raw string evaluate to avoid tsx __name helper injection
  const injectResult = await page.evaluate(`
    (function() {
      var w = window;
      var t = ${JSON.stringify(TOKEN)};
      var u = ${JSON.stringify(USER)};

      // Step 1: Inject into Redux
      var s = w.__dva_store__;
      if (s) {
        var origGetState = s.getState;
        s.__origGetState = origGetState;
        var injected = {
          user: { currentUser: u, userMap: {} },
          login: { success: true, accessToken: t, loginFromMode: "page" },
          "@@initialState": { currentUser: u, settings: {} },
        };
        s.getState = function() {
          var base = origGetState.call(s);
          return Object.assign({}, base, injected);
        };
        s.dispatch({ type: "user/saveCurrentUser", payload: u });
        s.dispatch({ type: "login/changeLoginSucceeded", payload: { success: true, accessToken: t, loginFromMode: "page" } });
      }

      // Step 2: Find the @@initialState model hook in fiber tree
      var root = document.getElementById("root");
      var rootContainer = root && root._reactRootContainer;
      if (!rootContainer) { w.__inject_error__ = "no root container"; return "no root"; }
      var rootFiber = rootContainer._internalRoot.current;

      // Use stack-based DFS to avoid __name helper
      var stack = [[rootFiber, 0]];
      var foundInit = null;
      var foundStateRef = null;
      var hookDepth = 0;

      while (stack.length > 0) {
        var item = stack.pop();
        var fiber = item[0];
        var depth = item[1];
        if (!fiber || depth > 40) continue;

        var hook = fiber.memoizedState;
        while (hook) {
          var state = hook.memoizedState;
          if (state && typeof state === "object" && !Array.isArray(state)) {
            if (typeof state.setInitialState === "function" &&
                typeof state.refresh === "function" &&
                "initialState" in state &&
                "loading" in state) {
              foundInit = state.setInitialState;
              foundStateRef = state;
              hookDepth = depth;
              stack.length = 0; // break outer loop
              hook = null;
              break;
            }
          }
          if (hook) hook = hook.next;
        }
        if (foundInit) break;

        // Push children and siblings (right-to-left for DFS order)
        if (fiber.sibling) stack.push([fiber.sibling, depth]);
        if (fiber.child) stack.push([fiber.child, depth + 1]);
      }

      if (!foundInit) { w.__inject_error__ = "no model hook"; return "no setInitialState found"; }

      try {
        foundInit({ currentUser: u, settings: {} });
        w.__inject_success__ = true;
        w.__hook_depth__ = hookDepth;
        w.__prev_loading__ = foundStateRef ? foundStateRef.loading : null;
        return "setInitialState called at depth " + hookDepth + ", prev loading=" + (foundStateRef ? foundStateRef.loading : null);
      } catch (e) {
        w.__inject_error__ = String(e);
        return "setInitialState threw: " + String(e);
      }
    })();
  `);

  log("Inject result: " + injectResult);
  log("Waiting for re-render...");

  // Wait for React to re-render
  await page.waitForTimeout(4000);

  // Check results
  const result = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    return JSON.stringify({
      url: location.href,
      bodyText: document.body?.innerText?.slice(0, 600),
      rootHTML: (document.getElementById("root") as HTMLElement)?.innerHTML?.slice(0, 400),
      hooked: !!w.__inject_success__,
      depth: w.__hook_depth__,
      prevLoading: w.__prev_loading__,
      error: w.__inject_error__,
    }, null, 2);
  });

  log("Result:\n" + result);

  await page.screenshot({ path: "/tmp/apifox-setinitialstate.png" });
  log("Screenshot saved to /tmp/apifox-setinitialstate.png");

  await browser.close();
}

// Minimal FiberNode type for the inject script
type FiberNode = {
  tag: number;
  memoizedState: Hook | null;
  child: FiberNode | null;
  sibling: FiberNode | null;
  return: FiberNode | null;
  type: unknown;
  stateNode: unknown;
};

type Hook = {
  memoizedState: unknown;
  next: Hook | null;
  queue: unknown;
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
