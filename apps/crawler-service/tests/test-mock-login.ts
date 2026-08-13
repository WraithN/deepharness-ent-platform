/**
 * Mock the WeChat login API flow: intercept login endpoints so the app
 * thinks authentication succeeded, then it renders the dashboard natively.
 * Also capture ALL API requests to identify the exact login endpoints.
 */
import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];
const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";
const FAKE_USER_ID = 3232299;

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  const page = await ctx.newPage();

  // Collect ALL API requests and responses
  const allRequests: string[] = [];
  const allResponses: string[] = [];

  page.on("request", (req) => {
    if (req.url().includes("/api/")) {
      const method = req.method();
      const url = req.url();
      allRequests.push(`${method} ${url}`);
      log(`REQ: ${method} ${url}`);
    }
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      const status = res.status();
      let body = "";
      try { body = await res.text(); } catch(e) {}
      const snippet = body.slice(0, 200);
      allResponses.push(`${status} ${res.url()} => ${snippet}`);
      if (status >= 300) {
        log(`RESP: ${status} ${res.url()} => ${snippet}`);
      }
    }
  });

  // Block redirect to /user/login
  await page.addInitScript(`
    (function() {
      var op = history.pushState;
      history.pushState = function(s,t,u) { if (String(u).includes("/user/login")) return; return op.apply(this,arguments); };
      var or_ = history.replaceState;
      history.replaceState = function(s,t,u) { if (String(u).includes("/user/login")) return; return or_.apply(this,arguments); };
    })()
  `);

  // ===== Mock login API endpoints =====
  // Mock qrconnect endpoints (WeChat QR code login)
  await page.route("**/qrconnect/**", async (route) => {
    const url = route.request().url();
    log(`[MOCK] qrconnect: ${route.request().method()} ${url}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        data: {
          // Return successful login token
          accessToken: "MOCKED_LOGIN_TOKEN_" + FAKE_USER_ID,
          refreshToken: "MOCKED_REFRESH_TOKEN_" + FAKE_USER_ID,
          username: "狐友UgzW",
          userId: FAKE_USER_ID,
        },
      }),
    });
  });

  // Mock any login/signin endpoints
  await page.route("**/login**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    log(`[MOCK] login: ${method} ${url}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          accessToken: "MOCKED_LOGIN_TOKEN_" + FAKE_USER_ID,
          username: "狐友UgzW",
          userId: FAKE_USER_ID,
          avatar: "",
        },
      }),
    });
  });

  // Mock WeChat related endpoints (wx, wechat)
  await page.route("**/wx**", async (route) => {
    log(`[MOCK] wx: ${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, code: 0, data: { scanned: true, confirmed: true } }),
    });
  });

  // Mock user/current profile endpoint
  await page.route("**/user/profile**", async (route) => {
    log(`[MOCK] user/profile: ${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          id: FAKE_USER_ID,
          name: "狐友UgzW",
          username: "狐友UgzW",
          userid: String(FAKE_USER_ID),
          avatar: "",
          email: "test@local.dev",
        },
      }),
    });
  });

  // Mock current user endpoint
  await page.route("**/current/user**", async (route) => {
    log(`[MOCK] current/user: ${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          id: FAKE_USER_ID,
          name: "狐友UgzW",
          username: "狐友UgzW",
          userid: String(FAKE_USER_ID),
          avatar: "",
        },
      }),
    });
  });

  // Mock generic user info endpoints
  await page.route("**/user/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    // Skip non-GET/user-info requests (like user-trackings)
    if (url.includes("user-trackings")) {
      await route.continue();
      return;
    }
    log(`[MOCK] user/*: ${method} ${url}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          id: FAKE_USER_ID,
          name: "狐友UgzW",
          username: "狐友UgzW",
          userid: String(FAKE_USER_ID),
          avatar: "",
        },
      }),
    });
  });

  // Mock auth/me endpoint (common in UMI apps)
  await page.route("**/api/*auth*/**", async (route) => {
    log(`[MOCK] auth: ${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          id: FAKE_USER_ID,
          name: "狐友UgzW",
          username: "狐友UgzW",
          accessToken: "MOCKED_TOKEN_" + FAKE_USER_ID,
        },
      }),
    });
  });

  // Also mock the settings/config endpoint that getInitialState uses
  await page.route("**/api/v1/configs**", async (route) => {
    log(`[MOCK] configs: ${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          navTheme: "light", primaryColor: "#1890ff", layout: "top",
          contentWidth: "Fluid", fixedHeader: false, fixSiderbar: true,
          colorWeak: false, pwa: false, iconfontUrl: "", responseValidate: true,
        },
      }),
    });
  });

  // Mock the getInitialState call (which includes currentUser)
  // In UMI, it's app.getInitialState() — it might call an internal API
  // Let's also mock /api/v1/profiles or similar
  await page.route("**/api/v1/profiles**", async (route) => {
    log(`[MOCK] profiles: ${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          id: FAKE_USER_ID,
          name: "狐友UgzW",
          username: "狐友UgzW",
          avatar: "",
        },
      }),
    });
  });

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "load", timeout: 60000 });
  log(`Loaded: ${page.url()}`);

  // Wait additional time for client-side rendering
  await page.waitForTimeout(15000);
  log(`After 15s: ${page.url()}`);
  log(`Title: ${await page.title()}`);
  
  const body = await page.evaluate(`document.body ? document.body.innerText.slice(0, 500) : "no body"`);
  log(`Body: ${body.slice(0, 200)}`);

  // Check if we bypassed login
  const status = await page.evaluate(`
    JSON.stringify({
      url: location.href,
      hasLoginText: (document.body && document.body.innerText || "").indexOf("微信扫码") >=0,
      hasDashboard: (document.body && document.body.innerText || "").indexOf("项目管理") >=0 || (document.body && document.body.innerText || "").indexOf("团队") >=0,
      bodyLength: (document.body && document.body.innerText) ? document.body.innerText.length : 0,
    })
  `);
  log(`Status: ${status}`);

  // Save all captured requests
  log(`\n=== ALL CAPTURED REQUESTS (${allRequests.length}) ===`);
  allRequests.forEach(r => log(`  ${r}`));
  log(`\n=== ALL CAPTURED RESPONSES (${allResponses.length}) ===`);
  allResponses.forEach(r => log(`  ${r}`));

  await page.screenshot({ path: "/tmp/apifox-mock-login.png", fullPage: true });
  log("Screenshot saved");
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
