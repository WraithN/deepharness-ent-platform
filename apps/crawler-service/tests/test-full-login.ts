/**
 * Full login flow: mock login + user endpoint → dashboard crawl.
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
  createdAt: "2024-01-01T00:00:00.000Z",
};

// Full user response (matching what /api/v1/user returns)
const FULL_USER_RESPONSE = {
  success: true, code: 0,
  data: {
    ...USER_DATA,
    projects: [
      { id: 3883284, name: "Test Project", role: "owner", logo: "" },
    ],
    teams: [{ id: 12345, name: "Test Team", role: "owner" }],
    settings: {
      language: "zh-CN",
      theme: "light",
    },
  },
};

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });

  const page = await ctx.newPage();

  // Track all API calls
  const apiCalls: Array<{ method: string; url: string; status: number }> = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/")) {
      apiCalls.push({ method: res.request().method(), url: res.url().slice(0, 200), status: res.status() });
    }
  });

  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") log(`CONSOLE ERROR: ${msg.text().slice(0, 250)}`);
  });

  // === MOCK LOGIN ===
  await page.route("**/api/v1/login*", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    log("[MOCK] Login API called");
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        success: true, code: 0,
        data: { accessToken: "FAKE_LOGIN_TOKEN", user: USER_DATA },
      }),
    });
  });

  // === MOCK USER ENDPOINT (called after login) ===
  await page.route("**/api/v1/user**", async (route) => {
    const url = route.request().url();
    log(`[MOCK] User API called: ${route.request().method()} ${url.slice(0, 150)}`);
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(FULL_USER_RESPONSE),
    });
  });

  // === MOCK USER/ME, USER/CURRENT, USER/PROFILE variants ===
  await page.route("**/api/v1/user/me**", async (route) => {
    log(`[MOCK] /user/me called`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FULL_USER_RESPONSE) });
  });
  await page.route("**/api/v1/user/current**", async (route) => {
    log(`[MOCK] /user/current called`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FULL_USER_RESPONSE) });
  });
  await page.route("**/api/v1/user/profile**", async (route) => {
    log(`[MOCK] /user/profile called`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FULL_USER_RESPONSE) });
  });

  // === NAVIGATE ===
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

  // Wait for navigation to dashboard
  await page.waitForTimeout(5000);
  log(`Current URL: ${page.url()}`);

  // If still on login page, something went wrong
  if (page.url().includes("/user/login")) {
    log("FAILED: Still on login page");
    const body = await page.evaluate(`document.body.innerText.slice(0, 500)`);
    log(`Body: ${body}`);

    // Check for any error UI
    const errorEls = await page.evaluate(`
      (function() {
        var els = document.querySelectorAll('[class*="error"], [class*="Error"], .ant-form-item-explain');
        return Array.from(els).map(function(e) { return e.className + ': ' + e.textContent.trim().slice(0, 100); }).join('\\n');
      })()
    `);
    log(`Error elements: ${errorEls || "none"}`);
  } else {
    log("SUCCESS: Navigated to dashboard!");
    await page.waitForTimeout(3000);

    const title = await page.title();
    const body = await page.evaluate(`document.body ? document.body.innerText.slice(0, 1000) : "no body"`);
    log(`Title: ${title}`);
    log(`Body first 500:\n${body.slice(0, 500)}`);

    // Check main content panels
    const navItems = await page.evaluate(`
      (function() {
        var navs = document.querySelectorAll('nav a, nav span, [class*="sidebar"] a, [class*="SideBar"] a, [class*="menu"] a');
        return Array.from(navs).slice(0, 30).map(function(a) {
          return a.textContent.trim().slice(0, 60);
        }).filter(Boolean).join(' | ');
      })()
    `);
    log(`Nav items: ${navItems.slice(0, 500)}`);

    // Get project list
    const projectCards = await page.evaluate(`
      (function() {
        var cards = document.querySelectorAll('[class*="project"], [class*="Project"], [class*="card"], .ui-card');
        return Array.from(cards).slice(0, 20).map(function(c) {
          return c.textContent.trim().slice(0, 80);
        }).filter(Boolean).join(' | ');
      })()
    `);
    log(`Project cards: ${projectCards.slice(0, 500)}`);
  }

  log(`\n=== All API calls (${apiCalls.length}) ===`);
  apiCalls.forEach(c => log(`${c.method} [${c.status}] ${c.url}`));

  await page.screenshot({ path: "/tmp/apifox-dashboard.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
