/**
 * Fill login form, mock login API, capture the exact endpoint + flow.
 */
import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });

  const page = await ctx.newPage();

  // Track ALL POST requests to /api/ for debugging
  const postReqs: Array<{ url: string; postData: string; responseStatus?: number; responseBody?: string }> = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/")) {
      postReqs.push({ url: req.url().slice(0, 300), postData: req.postData() || "" });
    }
  });
  page.on("response", async (res) => {
    if (res.request().method() === "POST" && res.url().includes("/api/")) {
      const match = postReqs.find(r => r.url === res.url());
      if (match) {
        match.responseStatus = res.status();
        try { match.responseBody = (await res.text()).slice(0, 500); } catch(e) {}
      }
    }
  });

  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));

  // MOCK: ALL login-related API endpoints
  const LOGIN_RESPONSE = {
    success: true,
    code: 0,
    data: {
      accessToken: "MOCKED_ACCESS_TOKEN_FROM_LOGIN",
      token: "MOCKED_REFRESH_TOKEN",
      userId: 3232299,
      user: {
        id: 3232299,
        username: "testuser@apifox.com",
        name: "Test User",
        email: "testuser@apifox.com",
        phone: "13800138000",
        avatar: "",
        role: "owner",
      },
    },
  };

  // Broad match for any login/auth endpoint
  await page.route("**/api/v1/login/**", async (route) => {
    log(`[MOCK LOGIN] ${route.request().method()} ${route.request().url().slice(0, 150)}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LOGIN_RESPONSE) });
  });
  await page.route("**/api/v1/auth/**", async (route) => {
    log(`[MOCK AUTH] ${route.request().method()} ${route.request().url().slice(0, 150)}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LOGIN_RESPONSE) });
  });
  await page.route("**/api/v1/user/login**", async (route) => {
    log(`[MOCK USER LOGIN] ${route.request().method()} ${route.request().url().slice(0, 150)}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LOGIN_RESPONSE) });
  });
  // Also mock any POST that has "login" in the URL
  await page.route("**/*login*", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    log(`[MOCK LOGIN WILDCARD] ${route.request().method()} ${route.request().url().slice(0, 150)}`);
    const postData = route.request().postData() || "";
    log(`  POST body: ${postData.slice(0, 200)}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LOGIN_RESPONSE) });
  });

  // Navigate
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Switch to email form
  const switchBtn = page.locator('button:has-text("邮箱登录"), a:has-text("邮箱登录")');
  await switchBtn.first().click();
  await page.waitForTimeout(1000);
  log("Switched to email form");

  // Fill the form
  await page.fill('#account', 'testuser@apifox.com');
  await page.fill('#password', 'FakePassword123');
  log("Filled login form");

  // Submit
  const submitBtn = page.locator('button[type="submit"]:has-text("登 录")');
  await submitBtn.click();
  log("Clicked submit");

  // Wait for login flow
  await page.waitForTimeout(8000);
  log(`After login: ${page.url()}`);

  const title = await page.title();
  const body = await page.evaluate(`document.body ? document.body.innerText.slice(0, 800) : "no body"`);
  log(`Title: ${title}`);
  log(`Body: ${body.slice(0, 500)}`);

  log(`\n=== POST REQUESTS (${postReqs.length}) ===`);
  postReqs.forEach(r => {
    log(`${r.url}`);
    log(`  POST: ${r.postData.slice(0, 150)}`);
    log(`  RESP: ${r.responseStatus} ${r.responseBody || "no response"}`);
  });

  await page.screenshot({ path: "/tmp/apifox-login-submit.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
