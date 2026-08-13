/**
 * Full login flow - fixed route patterns with trailing wildcards.
 */
import { chromium } from "playwright";

const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

const USER_DATA = {
  id: 3232299,
  username: "testuser",
  name: "Test User",
  email: "test@apifox.com",
  phone: "13800138000",
  avatar: "",
  role: "owner",
};

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  const page = await ctx.newPage();

  const apiCalls: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/")) {
      apiCalls.push(`[${res.status()}] ${res.request().method()} ${res.url().slice(0, 250)}`);
    }
  });

  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") log(`CONSOLE: ${msg.text().slice(0, 300)}`);
  });

  // ===== Single catch-all handler for all mocked endpoints =====
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Login POST
    if (url.includes("/api/v1/login") && method === "POST") {
      log(`[MOCK] POST /login`);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          success: true, code: 0,
          data: { accessToken: "FAKE_LOGIN_TOKEN", user: USER_DATA },
        }),
      });
    }

    // User info
    if (url.includes("/api/v1/user-teams")) {
      log(`[MOCK] GET /user-teams`);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: [{ id: 12345, name: "Test Team", role: "owner", logo: "", memberCount: 1 }] }),
      });
    }

    if (url.includes("/api/v1/user/organizations")) {
      log(`[MOCK] GET /user/organizations`);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: [] }),
      });
    }

    if (url.includes("/api/v1/user-experiment")) {
      log(`[MOCK] GET /user-experiment`);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: {} }),
      });
    }

    // Catch-all /api/v1/user (but exclude sub-routes handled above)
    if (url.includes("/api/v1/user") && !url.includes("user-teams") && !url.includes("user-experiment") && !url.includes("organizations")) {
      log(`[MOCK] GET /api/v1/user (main)`);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: { ...USER_DATA } }),
      });
    }

    if (url.includes("/api/v1/payment/plans")) {
      log(`[MOCK] GET /payment/plans`);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: { currentPlan: null, availablePlans: [] } }),
      });
    }

    // Pass through everything else
    return route.continue();
  });

  // Block mixed-content
  await page.route("http://121.199.72.199/**", async (route) => route.abort());

  // ===== NAVIGATE =====
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);

  const switchBtn = page.locator('button:has-text("邮箱登录"), a:has-text("邮箱登录")');
  if (await switchBtn.count() > 0) {
    await switchBtn.first().click();
    await page.waitForTimeout(500);
  }

  await page.fill("#account", "testuser@apifox.com");
  await page.fill("#password", "FakePassword123");
  await page.locator('button[type="submit"]:has-text("登 录")').click();
  log("Login submitted");

  await page.waitForTimeout(8000);
  log(`\n=== RESULT ===`);
  log(`URL: ${page.url()}`);
  log(`Title: ${await page.title()}`);

  const body = await page.evaluate(`document.body ? document.body.innerText.slice(0, 1500) : "no body"`);
  log(`Body:\n${body || "(empty)"}`);

  const html = await page.evaluate(`(document.getElementById('root') || document.body).innerHTML.slice(0, 2000)`);
  log(`\nHTML:\n${html}`);

  log(`\n=== API calls (${apiCalls.length}) ===`);
  apiCalls.forEach(c => log(c));

  await page.screenshot({ path: "/tmp/apifox-dashboard-v3.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
