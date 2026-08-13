/**
 * Full login flow with correct per-endpoint response formats.
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

const TEAM_DATA = {
  id: 12345,
  name: "Test Team",
  role: "owner",
  logo: "",
  memberCount: 1,
};

const PROJECT_DATA = {
  id: 3883284,
  name: "Test Project",
  description: "",
  logo: "",
  teamId: 12345,
  role: "owner",
  apiCount: 0,
  createdAt: "2024-01-01",
};

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });

  const page = await ctx.newPage();

  // Track all API calls
  const apiCalls: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/")) {
      apiCalls.push(`[${res.status()}] ${res.request().method()} ${res.url().slice(0, 200)}`);
    }
  });

  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message} | stack: ${(err as any).stack?.slice(0, 200)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") log(`CONSOLE ERROR: ${msg.text().slice(0, 300)}`);
  });

  // ===== MOCKS =====

  // 1. Login
  await page.route("**/api/v1/login", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    log("[MOCK] POST /login");
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        success: true, code: 0,
        data: { accessToken: "FAKE_LOGIN_TOKEN_XXXX", user: USER_DATA },
      }),
    });
  });

  // 2. User (main user info)
  await page.route("**/api/v1/user", async (route) => {
    if (route.request().method() !== "GET" || route.request().url().includes("user-teams") || route.request().url().includes("user-experiment") || route.request().url().includes("organizations")) {
      await route.continue(); return;
    }
    log(`[MOCK] GET /api/v1/user`);
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        success: true, code: 0,
        data: { ...USER_DATA },
      }),
    });
  });

  // 3. User teams (returns array)
  await page.route("**/api/v1/user-teams*", async (route) => {
    log(`[MOCK] GET /api/v1/user-teams`);
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ success: true, code: 0, data: [TEAM_DATA] }),
    });
  });

  // 4. Organizations (returns array)
  await page.route("**/api/v1/user/organizations*", async (route) => {
    log(`[MOCK] GET /api/v1/user/organizations`);
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ success: true, code: 0, data: [] }),
    });
  });

  // 5. Experiment variants
  await page.route("**/api/v1/user-experiment*", async (route) => {
    log(`[MOCK] GET /api/v1/user-experiment-variants`);
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ success: true, code: 0, data: {} }),
    });
  });

  // 6. Payment plans
  await page.route("**/api/v1/payment/plans*", async (route) => {
    log(`[MOCK] GET /api/v1/payment/plans`);
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ success: true, code: 0, data: { currentPlan: null, availablePlans: [] } }),
    });
  });

  // 7. Block mixed-content IP requests (configs on http://121.199.72.199)
  await page.route("http://121.199.72.199/**", async (route) => {
    log(`[BLOCKED] Mixed-content: ${route.request().url().slice(0, 100)}`);
    await route.abort();
  });

  // ===== NAVIGATE =====
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);

  // Switch to email form
  const switchBtn = page.locator('button:has-text("邮箱登录"), a:has-text("邮箱登录")');
  if (await switchBtn.count() > 0) {
    await switchBtn.first().click();
    await page.waitForTimeout(500);
  }

  // Fill + submit
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

  // Dump HTML structure for debugging empty body
  const html = await page.evaluate(`
    (function() {
      var root = document.getElementById('root');
      if (!root) return 'NO ROOT';
      return root.innerHTML.slice(0, 2000);
    })()
  `);
  log(`\nRoot HTML:\n${html}`);

  log(`\n=== API calls (${apiCalls.length}) ===`);
  apiCalls.forEach(c => log(c));

  await page.screenshot({ path: "/tmp/apifox-dashboard-v2.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
