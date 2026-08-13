/**
 * Quick diagnostic: what's on the Apifox page after load?
 */
import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
  });
  await ctx.addCookies(COOKIES);

  const page = await ctx.newPage();

  // Block redirect
  await page.addInitScript(`
    var op = history.pushState;
    history.pushState = function(s,t,u) {
      if (u && String(u).includes('/user/login')) return;
      return op.apply(this,arguments);
    };
  `);

  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  // Diagnostic checks
  const diag = await page.evaluate(() => {
    const root = document.getElementById("root");
    const w = window as any;

    // All non-builtin keys on root
    const rootKeys = root ? Object.keys(root).filter(k => !k.startsWith('__react')) : [];
    const reactKeys = root ? Object.keys(root).filter(k => k.startsWith('__react')) : [];
    
    // Check for React
    const hasReact = typeof w.React !== "undefined";
    const reactVersion = hasReact ? w.React.version : "none";

    // Check for _reactRootContainer
    const rootContainerKey = root ? Object.keys(root).find(k => k.startsWith('_reactRootContainer') || k.startsWith('__reactContainer') || k.startsWith('__reactFiber') || k.includes('reactRoot') || k.includes('reactContainer') || k.includes('reactFiber')) : "no root";

    // Check for Dva/UMI globals
    const globals: Record<string, boolean> = {};
    ["g_app", "__umi_app__", "__dva_app__", "appData", "__INITIAL_STATE__"].forEach(k => {
      globals[k] = typeof (w as any)[k] !== "undefined";
    });

    // Check all window keys containing interesting patterns
    const windowKeys: string[] = [];
    Object.keys(w).filter(k => {
      const l = k.toLowerCase();
      return l.includes('dva') || l.includes('umi') || l.includes('store') || l.includes('redux') || l.includes('app') || l.includes('history');
    }).forEach(k => windowKeys.push(k));

    return {
      bodyText: document.body?.innerText?.slice(0, 500),
      url: location.href,
      rootExists: !!root,
      rootKeys,
      reactKeys,
      rootContainerKey: rootContainerKey || "NOT FOUND",
      hasReact,
      reactVersion,
      globals,
      windowKeys,
      scriptsCount: document.querySelectorAll('script').length,
    };
  });

  console.log(JSON.stringify(diag, null, 2));

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
