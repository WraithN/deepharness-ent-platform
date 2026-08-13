import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const USER = {
  id: 3232299, name: "狐友UgzW",
  avatar: "https://cdn.apifox.com/app/avatar/builtin/19.png",
  username: "狐友UgzW", employeeNumber: null, email: null,
  hasPassword: false, bio: "", mobile: null,
  createdAt: "2025-10-14T02:34:22.000Z", deletedAt: null,
  features: {}, unreadCount: 0,
};

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });

  const page = await ctx.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[apifox]")) console.log("[PAGE]", t.slice(0, 200));
  });

  console.log("[test] Navigating...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  console.log("[test] domcontentloaded, URL:", page.url().slice(0, 100));

  // Poll for Dva store (use string eval to avoid __name issue)
  const dvaResult = await page.evaluate(`(async () => {
    const start = Date.now();
    while (true) {
      if (window.__dva_store__) return "found at " + (Date.now() - start) + "ms";
      if (Date.now() - start > 8000) return "not found after " + (Date.now() - start) + "ms";
      await new Promise(r => setTimeout(r, 100));
    }
  })()`);
  console.log("[test] Dva:", dvaResult);
  console.log("[test] URL after Dva check:", page.url().slice(0, 100));

  // Combined injection: Redux getState override + walk fiber to call setInitialState
  const userJSON = JSON.stringify(USER);
  const injectResult = await page.evaluate(`(async (userJSON) => {
    const USER = JSON.parse(userJSON);
    const dw = window;
    const store = dw.__dva_store__;
    if (!store) return { error: "no_dva_store" };

    // Step 1: Override Redux getState
    const origGetState = store.getState.bind(store);
    store.getState = function() {
      const s = origGetState();
      const currentUser = { ...USER, features: {}, unreadCount: 0 };
      const patched = { ...s };
      if ("global" in patched) patched.global = { ...patched.global, currentUser };
      if ("user" in patched) patched.user = { ...patched.user, currentUser };
      if ("login" in patched) patched.login = { ...patched.login, currentUser };
      patched.currentUser = currentUser;
      return patched;
    };

    // Step 2: Walk React fiber to find @@initialState model hook
    const root = document.getElementById("root");
    if (!root) return { error: "no_root", hasDva: true };

    const fiberKey = Object.keys(root).find(k => k.startsWith("__reactFiber"));
    if (!fiberKey) return { error: "no_fiber_key", keys: Object.keys(root).slice(0, 5), hasDva: true };

    const startFiber = root[fiberKey];

    function walkModel(fiber, depth) {
      if (!fiber || depth > 35) return null;

      let hook = fiber.memoizedState;
      let hookIdx = 0;
      while (hook) {
        const val = hook.memoizedState;
        if (val && typeof val === "object" && "initialState" in val && "loading" in val) {
          // Collect info about this hook
          const info = { depth, hookIdx, hasInit: !!val.initialState, loading: val.loading, err: !!(val.error) };

          // Look for setInitialState in the hook chain
          let h = hook;
          while (h) {
            const v = h.memoizedState;
            if (v && typeof v === "object" && typeof v.setInitialState === "function") {
              try {
                v.setInitialState({ 
                  currentUser: USER,
                  settings: {},
                });
                return { called: true, depth, hookIdx, hasInit: !!val.initialState, loading: val.loading };
              } catch(e) {
                return { error: e.message, depth, hookIdx };
              }
            }
            // Also try dispatch on queue
            if (h.queue && typeof h.queue.dispatch === "function") {
              try {
                h.queue.dispatch({ currentUser: USER, settings: {} });
                return { called: true, depth, hookIdx, method: "dispatch" };
              } catch(e2) {}
            }
            h = h.next;
          }
          return info;
        }
        hook = hook.next;
        hookIdx++;
      }

      return walkModel(fiber.child, depth + 1) || walkModel(fiber.sibling, depth + 1);
    }
    return { ...(walkModel(startFiber, 0) || { error: "no_model_hook" }), hasDva: true };
  })(${JSON.stringify(userJSON)})`);

  console.log("[test] Inject result:", JSON.stringify(injectResult, null, 2));

  // Monitor URL changes
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (url.includes("/user/login")) {
      console.log(`[test] Redirected to login at +${i+1}s`);
      break;
    }
    if (i % 3 === 0) console.log(`[test] +${i+1}s, URL: ${url.slice(0, 120)}`);
  }

  // Screenshot for visual inspection
  await page.screenshot({ path: "/tmp/apifox-combined.png", fullPage: true });
  console.log("[test] Screenshot saved to /tmp/apifox-combined.png");

  const final = await page.evaluate(`JSON.stringify({
    url: location.href,
    bodyText: (document.body?.innerText || "").slice(0, 400),
    rootHTML: (document.getElementById("root")?.innerHTML || "").slice(0, 300),
  })`);
  console.log("[test] Final:", final);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
