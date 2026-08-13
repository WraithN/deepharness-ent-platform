/**
 * Test: use addInitScript to inject auth BEFORE React boots,
 * block login redirect, and call setInitialState on the model hook.
 *
 * Key insight: page.evaluate() is too slow — redirect happens first.
 * addInitScript runs before ANY JavaScript on the page.
 *
 * Usage: npx tsx src/test-pre-boot-inject.ts
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

// This script runs BEFORE any page JS, via addInitScript.
// It polls for Dva store creation and injects auth immediately.
const PRE_BOOT_SCRIPT = `
window.__TOKEN__ = ${JSON.stringify(TOKEN)};
window.__USER__ = ${JSON.stringify(USER)};

(function() {
  var TOKEN = window.__TOKEN__;
  var USER = window.__USER__;

  // Block redirects to /user/login via history API
  var origPush = history.pushState.bind(history);
  var origReplace = history.replaceState.bind(history);
  var blocked = false;

  history.pushState = function(state, title, url) {
    if (typeof url === "string" && url.indexOf("/user/login") >= 0) {
      window.__login_redirect_blocked__ = (window.__login_redirect_blocked__ || 0) + 1;
      console.log("[pre-boot] blocked pushState to login:", url.slice(0, 80));
      return; // block
    }
    return origPush(state, title, url);
  };
  history.replaceState = function(state, title, url) {
    if (typeof url === "string" && url.indexOf("/user/login") >= 0) {
      window.__login_redirect_blocked__ = (window.__login_redirect_blocked__ || 0) + 1;
      console.log("[pre-boot] blocked replaceState to login:", url.slice(0, 80));
      return; // block
    }
    return origReplace(state, title, url);
  };

  // ALSO hook location.href setter (UMI might use assign/replace too)
  var locDesc = Object.getOwnPropertyDescriptor(Location.prototype, "href") ||
                Object.getOwnPropertyDescriptor(window.location.__proto__, "href") ||
                Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, "href");
  // Not reliable — skip this approach. history hooks should be enough.

  // Poll for Dva store creation
  var attempts = 0;
  var maxAttempts = 300; // 30 seconds at 100ms interval
  var timer = setInterval(function() {
    attempts++;
    var store = window.__dva_store__;
    if (store) {
      clearInterval(timer);
      injectAuth(store);
      return;
    }
    if (attempts >= maxAttempts) {
      clearInterval(timer);
      console.log("[pre-boot] timed out waiting for Dva store");
    }
  }, 100);

  function injectAuth(store) {
    console.log("[pre-boot] Dva store found after " + (attempts * 100) + "ms, injecting auth...");

    // Override getState
    var origGetState = store.getState;
    store.__origGetState = origGetState;
    var injected = {
      user: { currentUser: USER, userMap: {} },
      login: { success: true, accessToken: TOKEN, loginFromMode: "page" },
      "@@initialState": { currentUser: USER, settings: {} },
    };
    store.getState = function() {
      var base = origGetState.call(store);
      return Object.assign({}, base, injected);
    };
    window.__injected__ = true;

    // Dispatch real actions
    store.dispatch({ type: "user/saveCurrentUser", payload: USER });
    store.dispatch({ type: "login/changeLoginSucceeded", payload: { success: true, accessToken: TOKEN, loginFromMode: "page" } });

    // Now poll for model hook to call setInitialState
    var modelAttempts = 0;
    var modelMax = 200;

    function findAndCallSetInit() {
      modelAttempts++;
      var root = document.getElementById("root");
      if (!root || !root._reactRootContainer) {
        if (modelAttempts < modelMax) setTimeout(findAndCallSetInit, 100);
        return;
      }

      var rootFiber = root._reactRootContainer._internalRoot.current;
      var stack = [[rootFiber, 0]];
      var found = false;

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
              console.log("[pre-boot] calling setInitialState at depth " + depth);
              st.setInitialState({ currentUser: USER, settings: {} });
              window.__setInitCalled__ = true;
              found = true;
              stack.length = 0;
              break;
            }
          }
          hk = hk.next;
        }
        if (found) break;
        if (fiber.sibling) stack.push([fiber.sibling, depth]);
        if (fiber.child) stack.push([fiber.child, depth + 1]);
      }

      if (!found && modelAttempts < modelMax) {
        setTimeout(findAndCallSetInit, 100);
      } else if (!found) {
        console.log("[pre-boot] setInitialState not found after " + modelAttempts + " attempts");
      }
    }
    setTimeout(findAndCallSetInit, 500); // Wait for React to mount component tree
  }
})();
`;

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

  // Inject pre-boot script
  await ctx.addInitScript(PRE_BOOT_SCRIPT);
  // Additional stealth
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  `);

  const page = await ctx.newPage();

  // Track console messages
  const consoleMsgs: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[pre-boot]")) {
      consoleMsgs.push(text.slice(0, 200));
    }
  });

  // Track URL changes
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      log("URL changed to: " + frame.url().slice(0, 120));
    }
  });

  log("Navigating to " + TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for injection + re-render
  const maxWait = 20000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const done = await page.evaluate(() => !!(window as any).__setInitCalled__);
    if (done) break;
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(3000);

  // Gather results
  const info = await page.evaluate(() => {
    const w = window as any;
    return JSON.stringify({
      url: location.href,
      bodyText: document.body?.innerText?.slice(0, 600),
      rootHTML: document.getElementById("root")?.innerHTML?.slice(0, 400),
      injected: !!w.__injected__,
      setInitCalled: !!w.__setInitCalled__,
      redirectsBlocked: w.__login_redirect_blocked__ || 0,
      hasDvaStore: !!w.__dva_store__,
    }, null, 2);
  });

  log("Result:\n" + info);

  if (consoleMsgs.length > 0) {
    log("Console (" + consoleMsgs.length + "): ");
    consoleMsgs.forEach((m) => log("  " + m));
  }

  await page.screenshot({ path: "/tmp/apifox-preboot.png" });
  log("Screenshot: /tmp/apifox-preboot.png");

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
