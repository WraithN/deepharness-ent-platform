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

const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  // Set localStorage tokens
  await ctx.addInitScript(`(function() {
    localStorage.setItem("Context:accessToken", "${TOKEN}");
    localStorage.setItem("currentAccessToken", "${TOKEN}");
    localStorage.setItem("userToken", "${TOKEN}");
    localStorage.setItem("user", '${JSON.stringify(USER)}');
    localStorage.setItem("currentUser", '${JSON.stringify(USER)}');
  })()`);

  // Block auth guard redirects
  await ctx.addInitScript({
    content: buildRedirectBlockScript(APIFOX_INJECT_CONFIG.redirectPatterns),
  });

  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  `);

  const page = await ctx.newPage();
  const apiCalls: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("api") || u.includes("user") || u.includes("login")) {
      apiCalls.push(`${req.method()} ${u.slice(0, 120)}`);
    }
  });

  log("Navigating to main page...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  log(`API calls (${apiCalls.length}):`);
  apiCalls.filter(c => !c.includes("cdn.apifox.com") && !c.includes("blob:")).forEach(c => log(`  ${c}`));

  // Inject auth with user data for context injection
  log("Injecting auth (Redux + React Context)...");
  const injected = await injectDvaAuth(page, APIFOX_INJECT_CONFIG, USER);

  if (!injected) {
    log("FAILED to inject auth");
    const url = page.url();
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
    log(`URL: ${url}`);
    log(`Body: ${body}`);
  } else {
    log("Auth injection succeeded!");

    // Monitor URL for 30 seconds
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const url = page.url();
      if (i % 5 === 0) log(`+${i+1}s URL: ${url.slice(0, 120)}`);
      if (url.includes("/user/login")) {
        log(`Redirected to login at +${i+1}s`);
        break;
      }
    }

    const final = await page.evaluate(() => JSON.stringify({
      url: location.href,
      bodyText: (document.body?.innerText || "").slice(0, 500),
      rootChildren: document.getElementById("root")?.children.length || 0,
    }));
    log(`Final: ${final}`);
  }

  await page.screenshot({ path: "/tmp/apifox-context-inject.png", fullPage: true });
  log("Screenshot: /tmp/apifox-context-inject.png");

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
