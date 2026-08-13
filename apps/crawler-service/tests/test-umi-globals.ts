/**
 * Check UMI globals on window to find how to inject initial state.
 */
import { chromium } from "playwright";
import {
  APIFOX_INJECT_CONFIG,
  buildRedirectBlockScript,
  injectDvaAuth,
} from "./services/dva-auth-injector.js";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];
const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent: UA, locale: "zh-CN", viewport: { width: 1920, height: 1080 } });
  await ctx.addCookies(COOKIES);
  await ctx.addInitScript({ content: buildRedirectBlockScript(APIFOX_INJECT_CONFIG.redirectPatterns) });

  const page = await ctx.newPage();
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });
  
  await injectDvaAuth(page, APIFOX_INJECT_CONFIG);
  await page.waitForTimeout(2000);

  // Dump ALL UMI/Dva related globals from window
  const globals = await page.evaluate(() => {
    const w = window as any;
    const result: Record<string, any> = {};
    
    // Check specific UMI-related globals
    const checkKeys = [
      "g_plugins", "g_app", "g_initialData", "g_basename", 
      "__umi_plugin_initial_state", "__UMI_APP__",
      "g_routes", "g_modifyRoutes",
      "g_pluginConfig", "g_history",
      "appData", "__dva_app_name__",
      "umiHistory", "dvaDispatch",
    ];
    
    for (const k of checkKeys) {
      if (typeof w[k] !== "undefined") {
        const val = w[k];
        if (typeof val === "function") {
          result[k] = "[Function]";
        } else if (val && typeof val === "object") {
          result[k] = Object.keys(val).slice(0, 20);
        } else {
          result[k] = val;
        }
      }
    }
    
    // Also check store internals
    const store = w.__dva_store__;
    if (store) {
      const storeKeys = Object.keys(store).filter(k => !k.startsWith('_'));
      result.storeKeys = storeKeys;
    }
    
    // Check all window keys matching patterns
    const allMatching: string[] = [];
    for (const k of Object.keys(w)) {
      const l = k.toLowerCase();
      if (l.includes('umi') || l.includes('dva') || l.includes('initial_state') || l.includes('initialstate') || l.includes('plugin')) {
        allMatching.push(k);
      }
    }
    result.matchingWindowKeys = allMatching;
    
    // Check the store's dispatch function signature
    if (store) {
      result.dispatchString = String(store.dispatch).slice(0, 200);
    }
    
    return result;
  });
  
  console.log(JSON.stringify(globals, null, 2));

  // Try to dispatch @@initialState/saveState directly
  console.log("\n>>> Trying to create @@initialState model...");
  const try1 = await page.evaluate(() => {
    const store = (window as any).__dva_store__;
    try {
      store.dispatch({ type: '@@initialState/@@save', payload: { currentUser: { id: 999 } } });
      return "dispatched @@initialState/@@save";
    } catch(e: any) {
      return "error: " + e.message;
    }
  });
  console.log("Try @@save:", try1);
  
  await page.waitForTimeout(1000);
  
  const afterState = await page.evaluate(() => {
    const store = (window as any).__dva_store__;
    const state = store.getState();
    return {
      keys: Object.keys(state),
      initialState: typeof state["@@initialState"] === "undefined" ? "still missing" : JSON.stringify(state["@@initialState"]).slice(0, 300),
      rootHTML: document.getElementById("root")?.innerHTML?.slice(0, 300),
    };
  });
  console.log("After dispatch:", JSON.stringify(afterState, null, 2));

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
