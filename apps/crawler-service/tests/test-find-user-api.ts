/**
 * Find the API endpoint that getInitialState() calls to fetch user data.
 * Intercepts ALL API calls, logs responses with user-like data.
 * Then mocks that endpoint to return our user data.
 */
import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];

const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";

const FAKE_USER = {
  id: 3232299, name: "狐友UgzW", username: "狐友UgzW",
  avatar: "https://cdn.apifox.com/app/avatar/builtin/19.png",
  email: null, employeeNumber: null, mobile: null,
  hasPassword: false, bio: "",
  createdAt: "2025-10-14T02:34:22.000Z", deletedAt: null,
  features: {}, unreadCount: 0,
};

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  // Block redirects
  await ctx.addInitScript(`
    (function() {
      var op = history.pushState; history.pushState = function(s,t,u) { if(String(u).includes("/user/login")) return; return op.apply(this,arguments); };
      var or_ = history.replaceState; history.replaceState = function(s,t,u) { if(String(u).includes("/user/login")) return; return or_.apply(this,arguments); };
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    })()
  `);

  const page = await ctx.newPage();

  // Phase 1: Intercept ALL API responses and log ones with user-like data
  const apiCalls: { url: string; status: number; bodyPreview: string }[] = [];
  const userApiCandidates: string[] = [];

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const isApi = url.includes("api.apifox.com") || url.includes("app.apifox.com/api");

    if (!isApi) { await route.continue(); return; }

    try {
      const response = await route.fetch();
      const status = response.status();
      const ct = response.headers()["content-type"] || "";

      if (ct.includes("json")) {
        const text = await response.text();
        const preview = text.slice(0, 300);

        // Check if response looks like user data
        const hasUserFields = text.includes('"username"') || text.includes('"currentUser"') ||
                              text.includes('"name"') && text.includes('"id"');
        if (hasUserFields && status === 200) {
          userApiCandidates.push(`[${route.request().method()}] ${url}`);
          log(`[CANDIDATE] ${route.request().method()} ${url.slice(0, 150)}`);
          log(`  Body: ${preview}`);
        }
        apiCalls.push({ url: url.slice(0, 150), status, bodyPreview: preview });
      }

      await route.fulfill({ response });
    } catch {
      await route.continue();
    }
  });

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for initial data loading
  await page.waitForTimeout(8000);

  log(`\n=== Phase 1 Results ===`);
  log(`Total API calls: ${apiCalls.length}`);
  log(`User API candidates (${userApiCandidates.length}):`);
  userApiCandidates.forEach(u => log(`  ${u}`));

  if (userApiCandidates.length === 0) {
    log("No user API candidates found. Dumping all API calls:");
    apiCalls.forEach(c => log(`  ${c.status} ${c.url} | ${c.bodyPreview}`));
  }

  // Phase 2: Check what @@initialState looks like now
  const stateCheck = await page.evaluate(`
    (function() {
      var store = window.__dva_store__;
      if (!store) return JSON.stringify({ error: "no_store" });
      var state = store.getState();
      var init = state["@@initialState"];
      return JSON.stringify({
        hasInitState: !!init,
        initType: init ? typeof init : null,
        initKeys: init ? Object.keys(init) : null,
        userKeys: state.user ? Object.keys(state.user) : null,
        userCurrentUser: state.user && state.user.currentUser ? "present" : "missing",
        loginKeys: state.login ? Object.keys(state.login) : null,
      });
    })()
  `);
  log(`\n=== State Check ===\n${stateCheck}`);

  // Phase 2.5: Walk fiber to find @@initialState hooks
  const fiberCheck = await page.evaluate(`
    (function() {
      var root = document.getElementById("root");
      if (!root) return "no_root";
      var rk = Object.keys(root).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); });
      if (!rk) return "no_fiber_key";

      var matches = [];
      var walk = function(fiber, depth) {
        if (!fiber || depth > 50) return;
        var hook = fiber.memoizedState;
        var idx = 0;
        while (hook && idx < 30) {
          var v = hook.memoizedState;
          if (v && typeof v === "object" && "initialState" in v && "loading" in v) {
            var initVal = v.initialState;
            var initStr = initVal === undefined ? "undefined" : initVal === null ? "null" :
              typeof initVal !== "object" ? String(initVal) : JSON.stringify(initVal, null, 2);
            matches.push({
              depth: depth, hookIdx: idx,
              loading: v.loading,
              error: !!v.error,
              hasSetInit: typeof v.setInitialState === "function",
              hasRefresh: typeof v.refresh === "function",
              initialState: initStr.slice(0, 500),
            });
          }
          hook = hook.next;
          idx++;
        }
        walk(fiber.child, depth + 1);
        walk(fiber.sibling, depth);
      };
      try { walk(root[rk], 0); } catch(e) { return "walk_err:" + e.message; }
      return JSON.stringify(matches, null, 2);
    })()
  `);
  log(`\n=== Fiber @@initialState Hooks ===\n${fiberCheck}`);

  // Phase 3: Navigate again with API mocking
  log("\n=== Phase 3: Mock user API ===");
  await page.close();
  const page2 = await ctx.newPage();

  // Clear all routes and set up mock
  await page2.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    // Try to match the user endpoint pattern from Phase 1
    // Common patterns: /users/current, /user/currentUser, /self, /account, /profile
    const isUserEndpoint = url.includes("/current") || url.includes("/self") || url.includes("/profile") ||
                           url.includes("/account") || url.includes("currentUser");

    if (isUserEndpoint) {
      log(`[MOCK] Intercepted: ${route.request().method()} ${url.slice(0, 120)}`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: FAKE_USER }),
      });
      return;
    }
    await route.continue();
  });

  // Also try intercepting ALL api calls with user data
  // First let the real request go through, then check if response has user data
  await page2.route("**/*", async (route) => {
    const url = route.request().url();
    if (!(url.includes("api.apifox.com") || url.includes("app.apifox.com/api"))) {
      await route.continue();
      return;
    }

    try {
      const response = await route.fetch();
      const ct = response.headers()["content-type"] || "";
      if (ct.includes("json")) {
        const text = await response.text();
        if (text.includes('"username"') || text.includes('"currentUser"')) {
          const preview = text.slice(0, 300);
          log(`[RESP] ${url.slice(0, 120)} → ${preview}`);
          // Try to replace with mock user
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ success: true, data: FAKE_USER }),
          });
          return;
        }
      }
      await route.fulfill({ response });
    } catch {
      await route.continue();
    }
  });

  log("Navigating with mock...");
  await page2.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });

  for (let i = 0; i < 15; i++) {
    await page2.waitForTimeout(1000);
    const url = page2.url();
    log(`+${i+1}s URL: ${url.slice(0, 120)}`);
    if (!url.includes("/user/login")) break;
  }

  const final = await page2.evaluate(`
    JSON.stringify({
      url: location.href,
      bodyText: (document.body?.innerText || "").slice(0, 500),
      hasDvaStore: !!window.__dva_store__,
    })
  `);
  log(`\n=== Final ===\n${final}`);

  await page2.screenshot({ path: "/tmp/apifox-mock-api.png", fullPage: true });
  log("Screenshot: /tmp/apifox-mock-api.png");

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

