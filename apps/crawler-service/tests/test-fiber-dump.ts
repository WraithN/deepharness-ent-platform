import { chromium } from "playwright";
import {
  APIFOX_INJECT_CONFIG,
  buildRedirectBlockScript,
} from "./services/dva-auth-injector.js";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const USER = { id: 3232299, name: "狐友UgzW", avatar: "https://cdn.apifox.com/app/avatar/builtin/19.png", username: "狐友UgzW" };

const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  await ctx.addInitScript(`(function() {
    localStorage.setItem("Context:accessToken", "${TOKEN}");
    localStorage.setItem("currentAccessToken", "${TOKEN}");
    localStorage.setItem("userToken", "${TOKEN}");
    localStorage.setItem("user", '${JSON.stringify(USER)}');
    localStorage.setItem("currentUser", '${JSON.stringify(USER)}');
  })()`);

  await ctx.addInitScript({
    content: buildRedirectBlockScript(APIFOX_INJECT_CONFIG.redirectPatterns),
  });

  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  `);

  const page = await ctx.newPage();

  log("Navigating...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });

  log("Waiting 3s for Dva + React...");
  await page.waitForTimeout(3000);

  // Dump all hooks to find setInitialState
  const userJSON = JSON.stringify(USER);
  const dumpResult = await page.evaluate(function(d: string) {
    var USER = JSON.parse(d);
    var root = document.getElementById("root") as HTMLElement;
    if (!root) return "no root";

    var rk = Object.keys(root).find(function(k: string) { return k.startsWith("__reactFiber") || k.startsWith("__reactContainer"); }) as string;
    if (!rk) return "no fiber key";

    var results: any[] = [];
    var stack: Array<{f: any; depth: number; path: string}> = [{f: (root as any)[rk], depth: 0, path: ""}];
    var processed = 0;
    var maxProcess = 5000;

    while (stack.length > 0 && processed < maxProcess) {
      processed++;
      var entry = stack.pop()!;
      var fiber = entry.f;
      if (!fiber) continue;

      var hook = fiber.memoizedState;
      var hookIdx = 0;
      while (hook) {
        var val = hook.memoizedState;
        if (val && typeof val === "object") {
          var keys = Object.keys(val);
          var hasInit = keys.indexOf("initialState") >= 0;
          var hasSetInit = keys.indexOf("setInitialState") >= 0;
          var hasDispatch = keys.some(function(k: string) { return String(k).toLowerCase().indexOf("dispatch") >= 0 || String(k).toLowerCase().indexOf("setinit") >= 0; });

          if (hasSetInit || hasInit || hasDispatch) {
            var safeVal: any = {};
            keys.forEach(function(k: string) {
              var v = val[k];
              if (typeof v === "function") safeVal[k] = "[Function:" + (v.name || "anonymous") + "]";
              else if (typeof v === "string") safeVal[k] = v.slice(0, 50);
              else if (typeof v === "number" || typeof v === "boolean" || v === null) safeVal[k] = v;
              else if (typeof v === "object") safeVal[k] = Object.keys(v || {}).slice(0, 10);
              else safeVal[k] = typeof v;
            });
            results.push({
              depth: entry.depth,
              hookIdx: hookIdx,
              flag: hasSetInit ? "SETINIT" : hasInit ? "INIT" : "DISPATCH",
              val: safeVal,
            });
          }
        }
        hook = hook.next;
        hookIdx++;
      }

      if (fiber.child) stack.push({f: fiber.child, depth: entry.depth + 1, path: entry.path + "c"});
      if (fiber.sibling) stack.push({f: fiber.sibling, depth: entry.depth, path: entry.path + "s"});
    }

    return { results: results.slice(0, 40), total: results.length, processed: processed };
  }, userJSON);

  log(`Fiber hook dump: ${JSON.stringify(dumpResult, null, 2)}`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
