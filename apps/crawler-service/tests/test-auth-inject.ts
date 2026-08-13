/**
 * E2E test: bypass Apifox Dva/UMI auth guard via React fiber tree injection.
 *
 * Root cause: Apifox's main bundle NEVER dispatches `user/fetchCurrentUser`.
 * Without it, `currentUser.id` stays `0` and the auth guard redirects to
 * `/user/login` — even when valid cookies are present.
 *
 * This test uses dva-auth-injector to walk the React fiber tree, locate the
 * Redux store, and manually dispatch the missing effect. If the redirect
 * blocking works, the authenticated page renders without a full page reload.
 *
 * Usage: npx tsx src/test-auth-inject.ts
 */

import { chromium } from "playwright";
import {
  APIFOX_INJECT_CONFIG,
  buildRedirectBlockScript,
  injectDvaAuth,
} from "./services/dva-auth-injector.js";

// ── Apifox credentials ───────────────────────────────────────────────────

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";

const COOKIES = [
  {
    name: "Authorization",
    value: `Bearer ${TOKEN}`,
    domain: ".apifox.com",
    path: "/",
  },
  {
    name: "Authorization.sig",
    value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA",
    domain: ".apifox.com",
    path: "/",
  },
];

const TARGET_URL =
  "https://app.apifox.com/main/teams/3883284?tab=project";

const STEALTH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Helpers ──────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  log("Launching browser...");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    userAgent: STEALTH_USER_AGENT,
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });

  await context.addCookies(COOKIES);

  // ── Set localStorage tokens (belt + suspenders) ──────────────────────
  const setLocalStorage = TOKEN;
  await context.addInitScript((token: string) => {
    localStorage.setItem("Context:accessToken", token);
    localStorage.setItem("currentAccessToken", token);
    localStorage.setItem("userToken", token);
    const userPayload = JSON.stringify({
      id: 3232299,
      name: "\u72d0\u53cbUgzW",
      username: "\u72d0\u53cbUgzW",
    });
    localStorage.setItem("user", userPayload);
    localStorage.setItem("currentUser", userPayload);
  }, setLocalStorage);

  // ── Block auth guard redirects to /user/login ───────────────────────
  await context.addInitScript({
    content: buildRedirectBlockScript(
      APIFOX_INJECT_CONFIG.redirectPatterns,
    ),
  });

  // ── Stealth: hide webdriver ─────────────────────────────────────────
  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  `);

  const page = await context.newPage();

  // Collect console warnings
  const consoleLogs: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleLogs.push(`[${msg.type()}] ${msg.text().slice(0, 200)}`);
    }
  });

  // Track ALL network requests to find getInitialState API
  const apiCalls: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("api") || url.includes("user") || url.includes("login")) {
      apiCalls.push(`${req.method()} ${url.substring(0, 120)}`);
    }
  });

  log("Navigating to " + TARGET_URL);
  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  log(`API calls during page load (${apiCalls.length}):`);
  apiCalls.filter(c => !c.includes("cdn.apifox.com") && !c.includes("blob:")).forEach((c) => log(`  ${c}`));

  log("Waiting for React + Dva to initialize...");
  const injected = await injectDvaAuth(page, APIFOX_INJECT_CONFIG);

  // Probe: search fiber tree for UMI plugin-model context providers
  const ctxProbe = await page.evaluate(() => {
    const root = document.getElementById("root");
    if (!root) return "no root element";
    const allKeys = Object.keys(root).filter(k => k.startsWith("__react"));
    if (allKeys.length === 0) return `no react keys. All: ${JSON.stringify(Object.keys(root))}`;
    const rk = allKeys[0];

    const fiber: any = (root as any)[rk];
    const seenCtx = new Set<any>();
    const results: string[] = [];
    const q = [fiber];
    let depth = 0;
    
    while (q.length && depth < 50) {
      depth++;
      const f = q.shift();
      if (!f) continue;

      // tag=10 ContextProvider, tag=11 ContextConsumer  
      if ((f.tag === 10 || f.tag === 11) && f.type) {
        if (!seenCtx.has(f.type)) {
          seenCtx.add(f.type);
          const ctx = f.type;
          const cv = ctx._currentValue !== undefined ? ctx._currentValue : ctx._currentValue2;
          const cvStr = cv === undefined ? "UNDEF" 
            : cv === null ? "NULL"
            : typeof cv !== "object" ? String(cv).slice(0, 100)
            : Array.isArray(cv) ? `Array(${cv.length})`
            : JSON.stringify(Object.keys(cv));
          
          const disp = ctx.displayName || "";
          const calc = ctx.Consumer?.displayName || ctx.Provider?.displayName || "";
          results.push(
            `ctx depth=${depth} displayName="${disp}" consumer="${calc}" memoizedState=${!!f.memoizedState} _currentValue=${cvStr}`
          );
        }
      }

      if (f.child) q.push(f.child);
      if (f.sibling) q.push(f.sibling);
    }
    return results.length > 0 ? results.join("\n") : `scanned ${depth} levels, 0 ctx`;
  });
  log(`Fiber context probe (${ctxProbe.split('\n').length} providers):\n${ctxProbe}`);

  if (!injected) {
    log("FAILED: Could not inject auth state. Dumping diagnostics:");
    const pageUrl = page.url();
    console.log(`  Current URL: ${pageUrl}`);
    const pageBody = await page
      .evaluate(() => document.body?.innerText?.slice(0, 500))
      .catch(() => "(error reading body)");
    console.log(`  Page body: "${pageBody}"`);
    console.log(`  Console errors/warnings: ${consoleLogs.length}`);
    consoleLogs.forEach((m) => console.log(`    ${m}`));

    // Fallback: try to find store manually and dump state
    const storeState = await page.evaluate(() => {
      const w = window as Record<string, unknown>;
      const store = w.__dva_store__ as {
        getState(): Record<string, unknown>;
      } | null;
      return store
        ? JSON.stringify({
            user: (store.getState() as Record<string, unknown>).user,
            login: (store.getState() as Record<string, unknown>).login,
          })
        : null;
    });
    console.log(`  Store state: ${storeState}`);
    return;
  }

  log("Auth state injected successfully!");

  // ── Phase 2: Verify the authenticated page renders ──────────────────
  // After state change, connected components should re-render. Give it time.
  await page.waitForTimeout(2000);

  const finalUrl = page.url();
  const isLoginPage =
    finalUrl.includes("/user/login") || finalUrl.includes("/user/register");

  log(`Final URL: ${finalUrl}`);
  log(`Is login page: ${isLoginPage}`);

  // Check what's actually in the DOM
  const domSnapshot = await page.evaluate(() => {
    const root = document.getElementById("root");
    const innerHTML = root?.innerHTML?.slice(0, 500) || "(no root)";
    const childCount = root?.children.length ?? 0;
    return { innerHTML, childCount };
  });
  log(`DOM snapshot: ${JSON.stringify(domSnapshot, null, 2)}`);

  // Check whether store.dispatch reaches Redux subscribers
  const dispatchDiag = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__dva_store__ as {
      getState(): Record<string, unknown>;
      dispatch(a: { type: string }): unknown;
      subscribe(fn: () => void): () => void;
      replaceReducer: unknown;
      asyncReducers: Record<string, unknown>;
    } | null;
    if (!store) return "(no store)";

    const keys = Object.keys(store).slice(0, 30);
    const hasAsyncReducers = !!store.asyncReducers;

    // Test if dispatch reaches subscribers
    let firedCount = 0;
    const unsub = store.subscribe(() => { firedCount++; });

    // Try different action types
    store.dispatch({ type: "__DVA_INJECT" });
    store.dispatch({ type: "NOOP" });
    store.dispatch({ type: "@@INIT" });
    store.dispatch({ type: "routing/noop" });

    // Check state before and after dispatch
    const stateBefore = store.getState() as Record<string, unknown>;
    const hasInitialState = !!stateBefore["@@initialState"];

    unsub();

    return JSON.stringify({
      storeKeys: keys,
      hasAsyncReducers,
      asyncReducersKeys: store.asyncReducers ? Object.keys(store.asyncReducers) : null,
      subscriberFired: firedCount,
      hasInitialState,
    }, null, 2);
  });
  log(`Store dispatch diagnostic:\n${dispatchDiag}`);

  // Force re-render — try to find Dva app for proper model registration
  const dvaProbe = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__dva_store__ as Record<string, unknown> | null;
    if (!store) return "(no store)";

    // List ALL store keys (not just top ones)
    const allKeys = Object.getOwnPropertyNames(store).concat(
      Object.getOwnPropertyNames(Object.getPrototypeOf(store))
    );

    // Check for hidden Dva app reference
    const appKeys = allKeys.filter(k => 
      k.toLowerCase().includes("app") || k.toLowerCase().includes("dva")
    );

    // Check window for Dva/UMI globals
    const winKeys = Object.keys(w).filter(k => 
      k.toLowerCase().includes("dva") || 
      k.toLowerCase().includes("umi") || 
      k.toLowerCase().includes("app") ||
      k.startsWith("_") && k.length < 20
    ).slice(0, 20);

    // Try getting @@initialState from ORIGINAL getState (before our hook)
    let origStateHasInit = false;
    if (store.__origGetState) {
      try {
        const origState = (store.__origGetState as () => Record<string, unknown>)();
        origStateHasInit = !!origState["@@initialState"];
      } catch {}
    }

    return JSON.stringify({
      storePrototypeKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(store)).filter(k => k !== "constructor"),
      storeAllSpecialKeys: appKeys,
      windowDvaUmiKeys: winKeys,
      origStateHasInit,
      hasOrigGetState: !!store.__origGetState,
    }, null, 2);
  });
  log(`Dva app probe:\n${dvaProbe}`);

  const bodyText = await page.evaluate(() =>
    document.body?.innerText?.slice(0, 800),
  );
  log(`Page body after force render (first 800 chars): "${bodyText}"`);

  // Check for authenticated content markers
  log(`Page body (first 800 chars): "${bodyText}"`);

  const hasAuthContent = ["团队", "项目", "team", "project"].some((w) =>
    bodyText.toLowerCase().includes(w),
  );
  log(`Has authenticated content markers: ${hasAuthContent}`);

  // Dump Redux state for debugging
  const finalState = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const store = w.__dva_store__ as {
      getState(): Record<string, unknown>;
    } | null;
    if (!store) return "(no store)";
    const state = store.getState() as Record<string, unknown>;
    return JSON.stringify(
      {
        user: state.user,
        login: state.login,
        "@@initialState": state["@@initialState"],
      },
      null,
      2,
    );
  });
  console.log(`\nRedux state:\n${finalState}`);

  // Screenshot
  await page
    .screenshot({
      path: "/tmp/apifox-auth-inject.png",
      fullPage: true,
    })
    .catch(() => {});

  await browser.close();

  if (!isLoginPage && hasAuthContent) {
    log("SUCCESS: Authenticated page rendered!");
  } else if (!isLoginPage) {
    log("PARTIAL: Not on login page, but auth markers missing. Check screenshot at /tmp/apifox-auth-inject.png");
  } else {
    log("FAILED: Still on login page.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
