/**
 * Check why mock login doesn't work — look for errors, toasts, missing fields.
 */
import { chromium } from "playwright";

const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });

  const page = await ctx.newPage();

  // Enhanced error tracking
  const errors: string[] = [];
  page.on("pageerror", (err) => { errors.push(err.message); log(`PAGE ERROR: ${err.message}`); });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      log(`CONSOLE ${msg.type().toUpperCase()}: ${msg.text().slice(0, 250)}`);
    }
  });

  // Track ALL requests/responses
  const allReqs: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) {
      allReqs.push(`${req.method()} ${req.url().slice(0, 250)}`);
    }
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      try {
        const body = await res.text();
        allReqs.push(`  RESP [${res.status()}]: ${body.slice(0, 300)}`);
      } catch(e) {}
    }
  });

  // Try different login response formats
  const attemptFormats = [
    // Format 1: tokens as separate top-level fields (JWT-style)
    {
      name: "jwt-style",
      body: {
        success: true, code: 0,
        data: {
          access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzMjMyMjk5IiwidXNlcm5hbWUiOiJ0ZXN0dXNlciIsImV4cCI6OTk5OTk5OTk5OX0.fake",
          token_type: "Bearer",
          expires_in: 86400,
          refresh_token: "REFRESH_TOKEN_FAKE",
          user: {
            id: 3232299, username: "testuser", name: "Test User",
            email: "test@apifox.com", phone: "13800138000",
            avatar: "", role: "owner",
          },
        },
      },
    },
    // Format 2: simple fields
    {
      name: "simple",
      body: {
        success: true, code: 0,
        data: {
          accessToken: "FAKE_ACCESS_TOKEN",
          user: { id: 3232299, username: "testuser", name: "Test User", email: "test@apifox.com" },
        },
      },
    },
  ];

  for (const fmt of attemptFormats) {
    log(`\n=== Testing format: ${fmt.name} ===`);
    allReqs.length = 0;
    errors.length = 0;

    // Clear previous routes and set new
    await page.unrouteAll();
    await page.route("**/api/v1/login*", async (route) => {
      log(`[MOCK] Returning ${fmt.name} response`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fmt.body),
      });
    });

    // Navigate fresh
    await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1000);

    // Switch to email form
    const switchBtn = page.locator('button:has-text("邮箱登录"), a:has-text("邮箱登录")');
    if (await switchBtn.count() > 0) {
      await switchBtn.first().click();
      await page.waitForTimeout(500);
    }

    // Fill and submit
    await page.fill('#account', 'testuser@apifox.com');
    await page.fill('#password', 'FakePassword123');
    await page.locator('button[type="submit"]:has-text("登 录")').click();
    log("Submitted");

    await page.waitForTimeout(3000);

    const url = page.url();
    const body = await page.evaluate(`document.body.innerText.slice(0, 500)`);
    const success = !url.includes("/user/login") && !body.includes("登 录");

    log(`URL: ${url}`);
    log(`Body: ${body.slice(0, 200)}`);
    log(`Page errors: ${errors.length}`);

    // Check for Ant Design message/toast
    const toasts = await page.evaluate(`
      (function() {
        var msgs = document.querySelectorAll('.ant-message, .ant-notification, .ant-alert, .ui-message, .ui-toast, [class*="message"], [class*="toast"], [class*="error"]');
        var results = [];
        msgs.forEach(function(el) {
          if (el.textContent.trim()) results.push(el.className + ': ' + el.textContent.trim().slice(0, 100));
        });
        return results.slice(0, 10).join('\\n');
      })()
    `);
    log(`Toast/alert messages: ${toasts || "none"}`);

    if (success) {
      log("*** SUCCESS! Dashboard shown! ***");
      break;
    }

    // Also check network for what happened after login
    log(`\nAPI calls after submit:`);
    allReqs.forEach(r => log(`  ${r}`));
  }

  await page.screenshot({ path: "/tmp/apifox-login-formats.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
