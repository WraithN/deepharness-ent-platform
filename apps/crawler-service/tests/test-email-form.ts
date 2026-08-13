/**
 * Fill email login form, mock login API, capture auth flow.
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
  await ctx.addCookies([
    { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
    { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  ]);

  const page = await ctx.newPage();

  // Track ALL API calls
  const apiCalls: Array<{ method: string; url: string; body: string }> = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) {
      const data = { method: req.method(), url: req.url().slice(0, 300), body: req.postData() || "" };
      apiCalls.push(data);
    }
  });

  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));

  // Navigate to target
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Click "手机号/邮箱登录" to switch to email form
  const switchBtn = page.locator('button:has-text("邮箱登录"), a:has-text("邮箱登录")');
  await switchBtn.first().click();
  await page.waitForTimeout(2000);
  log("Switched to email login form");

  // Log all visible inputs
  const inputInfo = await page.evaluate(`
    (function() {
      var inputs = document.querySelectorAll('input:not([type="hidden"])');
      var results = [];
      inputs.forEach(function(inp, i) {
        results.push({
          index: i,
          type: inp.type,
          placeholder: inp.placeholder,
          name: inp.name,
          id: inp.id,
          class: (inp.className || '').slice(0, 80),
          visible: inp.offsetParent !== null,
        });
      });
      return JSON.stringify(results, null, 2);
    })()
  `);
  log(`\nInput fields:\n${inputInfo}`);

  // Log all visible buttons
  const btnInfo = await page.evaluate(`
    (function() {
      var btns = document.querySelectorAll('button, a[role="button"], [role="button"]');
      var results = [];
      btns.forEach(function(btn, i) {
        var text = btn.textContent.trim().slice(0, 50);
        if (!text) return;
        results.push({
          index: i,
          tag: btn.tagName.toLowerCase(),
          text: text,
          type: btn.type || '',
          class: (btn.className || '').slice(0, 80),
          visible: btn.offsetParent !== null,
        });
      });
      return JSON.stringify(results, null, 2);
    })()
  `);
  log(`\nVisible buttons:\n${btnInfo}`);

  await page.screenshot({ path: "/tmp/apifox-email-form.png", fullPage: true });

  // Find the email input and fill it
  const emailInput = page.locator('input[placeholder*="邮箱"], input[name*="email"], input[id*="email"], input[type="email"]').first();
  const phoneInput = page.locator('input[placeholder*="手机号"], input[name*="phone"], input[id*="phone"], input[type="tel"]').first();
  const passwordInput = page.locator('input[type="password"]').first();

  const hasEmail = (await emailInput.count()) > 0;
  const hasPhone = (await phoneInput.count()) > 0;
  const hasPassword = (await passwordInput.count()) > 0;

  log(`\nHas email input: ${hasEmail}`);
  log(`Has phone input: ${hasPhone}`);
  log(`Has password input: ${hasPassword}`);

  // Also try finding input before "登 录" button
  const allInputs = page.locator('input:not([type="hidden"])');
  const inputCount = await allInputs.count();
  log(`Total visible inputs: ${inputCount}`);

  for (let i = 0; i < inputCount; i++) {
    const inp = allInputs.nth(i);
    const ph = await inp.getAttribute('placeholder');
    const typ = await inp.getAttribute('type');
    const name = await inp.getAttribute('name');
    const id = await inp.getAttribute('id');
    log(`  Input[${i}]: type=${typ} placeholder="${ph}" name="${name}" id="${id}"`);
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
