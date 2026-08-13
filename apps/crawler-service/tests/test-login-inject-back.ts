/**
 * Test: Let page redirect to login, inject auth on login page,
 * then navigate back to main URL. Since UMI models are global,
 * calling setInitialState on the login page populates the same
 * @@initialState model used by the main layout.
 *
 * Usage: npx tsx src/test-login-inject-back.ts
 */

import { chromium } from "playwright";

const MAIN_URL = "https://app.apifox.com/main/teams/3883284?tab=project";
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

function makeInjectScript(token: string, user: typeof USER) {
  return `
(function() {
  var token = ${JSON.stringify(token)};
  var user = ${JSON.stringify(user)};

  // Step 1: Inject into Redux Dva store
  var store = window.__dva_store__;
  if (store) {
    var origGetState = store.getState;
    store.__origGetState = origGetState;
    var injected = {
      user: { currentUser: user, userMap: {} },
      login: { success: true, accessToken: token, loginFromMode: "page" },
      "@@initialState": { currentUser: user, settings: {} },
    };
    store.getState = function() {
      var base = origGetState.call(store);
      return Object.assign({}, base, injected);
    };
    store.dispatch({ type: "user/saveCurrentUser", payload: user });
    store.dispatch({ type: "login/changeLoginSucceeded", payload: { success: true, accessToken: token, loginFromMode: "page" } });
    window.__injected__ = true;
  } else {
    window.__inject_error__ = "no_dva_store";
  }

  // Step 2: Find @@initialState model hook and call setInitialState
  setTimeout(function() {
    var root = document.getElementById("root");
    if (!root || !root._reactRootContainer) { window.__inject_error__ = "no_root"; return; }

    var rootFiber = root._reactRootContainer._internalRoot.current;
    var stack = [[rootFiber, 0]];

    while (stack.length > 0) {
      var item = stack.pop();
      var fiber = item[0];
      var depth = item[1];
      if (!fiber || depth > 40) continue;

      var hk = fiber.memoizedState;
      while (hk) {
        var st = hk.memoizedState;
        if (st && typeof st === "object" && !Array.isArray(st)) {
          if (typeof st.setInitialState === "function" &&
              typeof st.refresh === "function" &&
              "initialState" in st &&
              "loading" in st) {
            st.setInitialState({ currentUser: user, settings: {} });
            window.__setInitCalled__ = true;
            window.__setInitDepth__ = depth;
            stack.length = 0;
            return;
          }
        }
        hk = hk.next;
      }
      if (fiber.sibling) stack.push([fiber.sibling, depth]);
      if (fiber.child) stack.push([fiber.child, depth + 1]);
    }
    window.__inject_error__ = "no_model_hook";
  }, 1000);
})();
`;
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
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  `);

  const page = await ctx.newPage();

  // Step 1: Navigate and wait for redirect to login
  log("Step 1: Navigate to main URL, wait for redirect to login...");
  await page.goto(MAIN_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  log("Current URL: " + page.url().slice(0, 100));

  // Step 2: Wait for Dva store on login page
  log("Step 2: Wait for Dva store...");
  try {
    await page.waitForFunction(() => !!(window as any).__dva_store__, { timeout: 10000 });
  } catch {
    log("Dva store not found after 10s");
  }

  await page.waitForTimeout(1000);

  // Step 3: Inject auth
  log("Step 3: Inject auth...");
  await page.evaluate(makeInjectScript(TOKEN, USER));

  // Wait for injection to take effect
  await page.waitForTimeout(3000);

  // Check injection status
  let status = await page.evaluate(() => ({
    injected: !!(window as any).__injected__,
    setInitCalled: !!(window as any).__setInitCalled__,
    setInitDepth: (window as any).__setInitDepth__,
    error: (window as any).__inject_error__,
    hasDva: !!(window as any).__dva_store__,
  }));
  log(`Injection status: ${JSON.stringify(status)}`);

  // Step 4: Navigate back to main URL
  log("Step 4: Navigate back to main URL...");
  await page.goto(MAIN_URL, { waitUntil: "networkidle", timeout: 30000 });

  await page.waitForTimeout(8000);

  // Step 5: Check final result
  const result = await page.evaluate(() => {
    const w = window as any;
    return JSON.stringify({
      url: location.href,
      bodyText: document.body?.innerText?.slice(0, 600),
      rootHTML: document.getElementById("root")?.innerHTML?.slice(0, 400),
      hasDva: !!w.__dva_store__,
      isLogin: location.href.indexOf("/user/login") >= 0,
    }, null, 2);
  });

  log("Final result:\n" + result);
  await page.screenshot({ path: "/tmp/apifox-back.png" });
  log("Screenshot: /tmp/apifox-back.png");

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
