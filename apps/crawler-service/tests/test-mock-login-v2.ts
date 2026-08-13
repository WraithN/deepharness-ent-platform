/**
 * Mock WeChat login polling to return success — bypass QR code scanning.
 */
import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];
const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  const requests: string[] = [];
  let loginPollingRequests: string[] = [];
  let userInfoCalled = false;

  const page = await ctx.newPage();

  // Mock: WeChat login polling → return "login success with token"
  await page.route("**/linked-accounts/wechat-official-account/login-user**", async (route) => {
    const url = route.request().url();
    log(`[MOCK] login-user poll: ${url.slice(0, 150)}`);
    loginPollingRequests.push(url);
    // Return a success response — as if user confirmed on WeChat
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          status: "success",
          loginStatus: "confirmed",
          accessToken: "MOCKED_ACCESS_TOKEN_AFTER_WECHAT_SCAN",
          token: "MOCKED_REFRESH_TOKEN",
          userId: 3232299,
          user: {
            id: 3232299,
            username: "testuser",
            name: "Test User After WeChat Login",
            email: "test@apifox.com",
            avatar: "",
          }
        }
      }),
    });
  });

  // Mock: any user/me/current endpoint → return valid user (for getInitialState)
  await page.route("**/api/v1/user/current**", async (route) => {
    log(`[MOCK] user/current called!`);
    userInfoCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          id: 3232299,
          username: "testuser",
          name: "Test User",
          email: "test@apifox.com",
          phone: "",
          avatar: "",
          role: "admin",
        }
      }),
    });
  });

  await page.route("**/api/v1/user/profile**", async (route) => {
    log(`[MOCK] user/profile called!`);
    userInfoCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        code: 0,
        data: {
          id: 3232299,
          username: "testuser",
          name: "Test User",
          email: "test@apifox.com",
        }
      }),
    });
  });

  // Track ALL API requests
  page.on("request", (req) => {
    if (req.url().includes("/api/")) requests.push(`${req.method()} ${req.url()}`);
  });

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "load", timeout: 30000 });
  log(`Loaded: ${page.url()}`);

  // Wait for login polling to happen and auth transition
  await page.waitForTimeout(10000);
  log(`After 10s: ${page.url()}`);

  const title = await page.title();
  const body = await page.evaluate(`document.body ? document.body.innerText.slice(0, 800) : "no body"`);
  const hasLogin = body.includes("微信扫码") || body.includes("登录");
  const hasDashboard = body.includes("项目") || body.includes("团队");

  log(`Title: ${title}`);
  log(`Body (first 400): ${body.slice(0, 400)}`);
  log(`Status: loginText=${hasLogin} dashboard=${hasDashboard}`);
  log(`Login polling calls: ${loginPollingRequests.length}`);
  log(`User info called: ${userInfoCalled}`);

  log(`\n=== ALL API REQUESTS (${requests.length}) ===`);
  requests.forEach(r => log(`  ${r}`));

  await page.screenshot({ path: "/tmp/apifox-mock-login-v2.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
