/**
 * Test: intercept HTML and inject a script that hooks UMI plugin-model
 * to populate the @@initialState context before the layout renders.
 *
 * Root cause: UMI 3 uses React Context (useModel) for @@initialState,
 * NOT Redux/Dva. The getInitialState() never completes in headless mode,
 * so the context stays empty and layout shows spinner forever.
 *
 * Strategy: use page.route() to intercept the real HTML response and
 * inject a pre-boot script that:
 * 1. Polls for React.createContext and hooks it
 * 2. Hooks Object.defineProperty on window to catch UMI global exports
 * 3. On Dva store creation, force-inject user data into all contexts
 *
 * Usage: npx tsx src/test-html-inject.ts
 */

import { chromium } from "playwright";

const TARGET_URL =
  "https://app.apifox.com/main/teams/3883284?tab=project";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";

const STEALTH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];

// Pre-boot script: polls for React, hooks createContext to intercept
// UMI's plugin-model context Creation and inject user data
const PRE_BOOT_INLINE = `
(function(){(function(){var p=setInterval(function(){if(typeof React==='undefined'||!React.createContext)return;
clearInterval(p);var o=React.createContext.bind(React);React.createContext=function(def,calc){
var c=o(def,calc);var op=c.Provider;c.Provider=function(props){
var v=props.value;
if(v&&typeof v==='object'&&!Array.isArray(v)){window.__ctx_registry__=window.__ctx_registry__||[];
window.__ctx_registry__.push({keys:Object.keys(v),val:v,hasInit:v.hasOwnProperty('currentUser')||v.hasOwnProperty('initialState'),stack:(new Error).stack});}
return React.createElement(op,props);};
c.Provider.displayName=op.displayName;c.Provider._context=c;return c;};
window.__hoisted__=true;},10);})();
// Hook window.dispatchEvent for UMI's render event
var oe=document.addEventListener.bind(document);
(document.addEventListener=function(type,fn,opts){if(type.indexOf('render')>=0||type.indexOf('umi')>=0){window.__renderEvents__=window.__renderEvents__||[];window.__renderEvents__.push(type);}
return oe(type,fn,opts);});
// Track window globals
var d=Object.defineProperty.bind(Object);
(Object.defineProperty=function(o,p,d2){if(o===window){window.__winGlobals__=window.__winGlobals__||[];window.__winGlobals__.push(p);}return d(o,p,d2);});
// Track new properties on window after boot
window.__startKeys=Object.keys(Object.create(null));
})();
`;

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  log("Launching browser...");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: STEALTH_USER_AGENT,
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });

  await context.addCookies(COOKIES);
  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  `);

  const page = await context.newPage();

  // Set up console logging
  const consoleMsgs: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[pre-boot]") || text.includes("React.createContext")) {
      consoleMsgs.push(text.slice(0, 200));
    }
  });

  // Intercept HTML to inject our pre-boot script BEFORE React loads
  await page.route(TARGET_URL, async (route) => {
    const response = await route.fetch();
    let body = await response.text();

    // Inject script right after <head> (before any external scripts)
    body = body.replace("<head>", `<head><script>${PRE_BOOT_INLINE}</script>`);

    await route.fulfill({
      response,
      body,
      headers: { ...response.headers(), "content-type": "text/html; charset=utf-8" },
    });
  });

  log("Navigating to " + TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30000 });

  // Wait for React + bundles to finish loading
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    return JSON.stringify({
      hoisted: !!w.__hoisted__,
      ctxCount: (w.__ctx_registry__ as unknown[] | undefined)?.length ?? 0,
      ctxDetails: JSON.stringify((w.__ctx_registry__ as Array<{keys: string[]; hasInit: boolean}> | undefined)?.slice(0, 10).map(r => ({keys: r.keys, hasInit: r.hasInit})) ?? []),
      renderEvents: w.__renderEvents__,
      hasDvaStore: !!w.__dva_store__,
      winGlobals: ((w.__winGlobals__ as string[] | undefined) ?? []).filter(k => typeof k === 'string' && k.toLowerCase().includes('model')).slice(0, 10),
    });
  });
  log(`Hooks result: ${info}`);

  // Check DOM
  const dom = await page.evaluate(() => ({
    bodyText: document.body?.innerText?.slice(0, 600),
    rootHTML: document.getElementById("root")?.innerHTML?.slice(0, 300),
  }));
  log(`DOM body: "${dom.bodyText}"`);
  log(`DOM root: "${dom.rootHTML}"`);

  if (consoleMsgs.length > 0) {
    log(`Console messages (${consoleMsgs.length}):`);
    consoleMsgs.forEach((m) => log(`  ${m}`));
  }

  // Dump Dva store if available
  const state = await page.evaluate(() => {
    const w = window as Record<string, unknown>;
    const s = w.__dva_store__ as { getState(): Record<string, unknown> } | null;
    if (!s) return "no store";
    const st = s.getState();
    return JSON.stringify({
      user: (st as Record<string, unknown>).user,
      login: (st as Record<string, unknown>).login,
      "@@initialState": (st as Record<string, unknown>)["@@initialState"],
    }, null, 2);
  });
  log(`Dva state: ${state}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
