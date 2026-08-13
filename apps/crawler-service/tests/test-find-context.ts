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

  const userJSON = JSON.stringify(USER);
  await ctx.addInitScript(`(function() {
    localStorage.setItem("Context:accessToken", "${TOKEN}");
    localStorage.setItem("currentAccessToken", "${TOKEN}");
    localStorage.setItem("userToken", "${TOKEN}");
    localStorage.setItem("user", '${userJSON}');
    localStorage.setItem("currentUser", '${userJSON}');
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

  log("Waiting 3s for React to render...");
  await page.waitForTimeout(3000);

  // Try intercepting fetch to mock user info API
  const result = await page.evaluate(`
    (function() {
      var originalFetch = window.fetch;
      var intercepts = [];
      window.fetch = function(url, options) {
        var urlStr = typeof url === "string" ? url : (url && url.url) || "";
        intercepts.push(urlStr.substring(0, 120));

        // Log the call with a full response handler
        if (urlStr.indexOf("currentUser") !== -1 || urlStr.indexOf("api/current") !== -1 || urlStr.indexOf("login/account") !== -1) {
          intercepts.push("*** INTERCEPTED currentUser: " + urlStr);
          return originalFetch.call(this, url, options).then(function(r) {
            return r.text().then(function(body) {
              intercepts.push("*** currentUser body: " + body.substring(0, 500));
              return r;
            });
          });
        }
        
        return originalFetch.call(this, url, options);
      };
      return JSON.stringify({ intercepts: intercepts, msg: "intercept active" });
    })()
  `);
  log(`Fetch intercept result: ${JSON.stringify(result, null, 2)}`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
