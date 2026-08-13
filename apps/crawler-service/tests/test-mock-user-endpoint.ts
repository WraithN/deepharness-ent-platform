/**
 * Mock getInitialState's user endpoint BEFORE page load.
 * If it returns valid user + settings, app skips login entirely.
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

  const requests: Array<{ method: string; url: string; status: number; body: string }> = [];

  const page = await ctx.newPage();

  // Listen for errors
  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") log(`CONSOLE ERROR: ${msg.text().slice(0, 200)}`);
  });

  // Capture all responses for debugging
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      try {
        const body = await res.text();
        requests.push({
          method: res.request().method(),
          url: res.url(),
          status: res.status(),
          body: body.slice(0, 500),
        });
      } catch(e) {}
    }
  });

  // MOCK: user endpoint used by getInitialState() — return valid user
  await page.route("**/api/v1/user?*", async (route) => {
    const url = route.request().url();
    log(`[MOCK] user endpoint: ${url.slice(0, 120)}`);
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
          phone: "13800138000",
          avatar: "",
          role: "owner",
          teamId: 3883284,
          lastTeamId: 3883284,
        },
      }),
    });
  });

  // Also mock user with no query params (fallback)
  await page.route("**/api/v1/user", async (route) => {
    log(`[MOCK] user no-query`);
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
          phone: "13800138000",
          avatar: "",
          role: "owner",
          teamId: 3883284,
          lastTeamId: 3883284,
        },
      }),
    });
  });

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  log(`Loaded: ${page.url()}`);

  await page.waitForTimeout(3000);

  const title = await page.title();
  const body = await page.evaluate(`document.body ? document.body.innerText.slice(0, 1000) : "no body"`);

  log(`\nTitle: ${title}`);
  log(`Body (first 600):\n${body.slice(0, 600)}`);

  log(`\n=== ALL API RESPONSES (${requests.length}) ===`);
  requests.forEach(r => {
    log(`${r.method} ${r.url}`);
    log(`  status=${r.status} body=${r.body.slice(0, 200)}`);
  });

  await page.screenshot({ path: "/tmp/apifox-mock-user.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
