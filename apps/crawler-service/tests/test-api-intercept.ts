import { chromium } from "playwright";
import {
  APIFOX_INJECT_CONFIG,
  buildRedirectBlockScript,
  injectDvaAuth,
} from "./services/dva-auth-injector.js";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const USER = {
  id: 3232299, name: "狐友UgzW",
  avatar: "https://cdn.apifox.com/app/avatar/builtin/19.png",
  username: "狐友UgzW", employeeNumber: null, email: null,
  hasPassword: false, bio: "", mobile: null,
  createdAt: "2025-10-14T02:34:22.000Z", deletedAt: null,
  features: {}, unreadCount: 0,
};
const userJSON = JSON.stringify(USER);
const RESP_BODY = JSON.stringify({ success: true, data: USER });

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

  // Intercept ALL API calls and log them
  const apiLog: string[] = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("api.apifox.com") || url.includes("app.apifox.com/api")) {
      const ts = new Date().toISOString().slice(11, 19);
      apiLog.push(`[${ts}] ${method} ${url.slice(0, 200)}`);
    }

    // Mock user/current API responses
    if (url.includes("users/current") || url.includes("user/current") || url.includes("currentUser") || url.includes("current-user")) {
      log(`*** INTERCEPTED: ${method} ${url.slice(0, 150)} → returning user`);
      await route.fulfill({ status: 200, contentType: "application/json", body: RESP_BODY });
      return;
    }

    await route.continue();
  });

  log("Navigating...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });

  log(`API calls captured (${apiLog.length}):`);
  apiLog.forEach(l => log(`  ${l}`));

  // Inject (context injection also runs)
  log("Injecting...");
  const injected = await injectDvaAuth(page, APIFOX_INJECT_CONFIG, USER);
  log(injected ? "Injected OK" : "Injection FAILED");

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (i % 5 === 0) log(`+${i+1}s URL: ${url.slice(0, 120)}`);
  }

  const final = await page.evaluate(() => JSON.stringify({
    url: location.href,
    bodyText: (document.body?.innerText || "").slice(0, 500),
    rootHTML: (document.getElementById("root")?.innerHTML || "").slice(0, 300),
  }));
  log(`Final: ${final}`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
