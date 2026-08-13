/**
 * Diagnostic: After auth injection, what does the DOM look like?
 * We know Redux state is correct — why is body empty?
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
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({ userAgent: UA, locale: "zh-CN", viewport: { width: 1920, height: 1080 } });
  await ctx.addCookies(COOKIES);

  await ctx.addInitScript({ content: buildRedirectBlockScript(APIFOX_INJECT_CONFIG.redirectPatterns) });
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  `);

  const page = await ctx.newPage();
  
  const capturedErrors: string[] = [];
  page.on("pageerror", (err) => { capturedErrors.push(err.message); });
  page.on("console", (msg) => { if (msg.type() === "error") capturedErrors.push(`CONSOLE: ${msg.text().slice(0, 200)}`); });

  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Check DOM BEFORE injection
  const before = await page.evaluate(() => {
    const root = document.getElementById("root");
    return {
      rootChildren: root?.children.length ?? 0,
      rootInnerHTML: root?.innerHTML?.slice(0, 500) ?? "no root",
      bodyText: document.body?.innerText?.slice(0, 300),
    };
  });
  console.log("BEFORE inject:", JSON.stringify(before, null, 2));

  const ok = await injectDvaAuth(page, APIFOX_INJECT_CONFIG);
  console.log("Injected:", ok);

  // Check DOM AFTER injection (give time for re-render)
  await page.waitForTimeout(3000);

  const after = await page.evaluate(() => {
    const root = document.getElementById("root");
    const w = window as any;
    const store = w.__dva_store__;
    const fullState = store ? store.getState() : null;
    
    const modelKeys = fullState ? Object.keys(fullState) : [];
    const loadingState = fullState?.loading ? JSON.stringify(fullState.loading).slice(0, 600) : "not present";
    const initialState = fullState?.["@@initialState"] ?? "NOT present";
    
    return {
      url: location.href,
      rootChildren: root?.children.length ?? 0,
      rootInnerHTML: root?.innerHTML?.slice(0, 1200) ?? "no root",
      bodyText: document.body?.innerText?.slice(0, 500) || "(empty)",
      modelKeys,
      loadingState,
      initialState: typeof initialState === "string" ? initialState : JSON.stringify(initialState).slice(0, 600),
      routingKeys: fullState?.routing ? Object.keys(fullState.routing) : [],
    };
  });
  console.log("\nAFTER inject:", JSON.stringify(after, null, 2));
  console.log("\nConsole/page errors:", capturedErrors.length ? capturedErrors.join("\n  ") : "none");

  // Try to force re-render by navigating within the app
  console.log("\n>>> Dispatching routing change to force render...");
  await page.evaluate(() => {
    const store = (window as any).__dva_store__;
    if (!store) return "no store";
    store.dispatch({ type: "routing/SaveState", payload: { location: { pathname: "/main/teams/3883284" } } });
    return "dispatched routing/SaveState";
  });
  
  await page.waitForTimeout(3000);

  const final = await page.evaluate(() => {
    const root = document.getElementById("root");
    return {
      rootChildren: root?.children.length ?? 0,
      rootInnerHTML: root?.innerHTML?.slice(0, 1200) ?? "no root",
      bodyText: document.body?.innerText?.slice(0, 500) || "(empty)",
    };
  });
  console.log("\nFINAL after routing dispatch:", JSON.stringify(final, null, 2));
  
  await page.screenshot({ path: "/tmp/apifox-diag2.png", fullPage: true });
  console.log("Screenshot saved to /tmp/apifox-diag2.png");

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
