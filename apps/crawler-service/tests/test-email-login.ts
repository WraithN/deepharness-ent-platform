/**
 * Click "手机号/邮箱登录" → fill form → mock login API → get dashboard.
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

  // Listen for ALL API requests
  const requests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) requests.push(`${req.method()} ${req.url().slice(0, 200)}`);
  });
  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));

  // Step 1: Navigate to target (will redirect to login)
  log("Step 1: Navigating...");
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  log(`Current URL: ${page.url()}`);
  
  await page.waitForTimeout(2000);

  // Step 2: Find and click "手机号/邮箱登录"
  log("Step 2: Switching to email login...");
  const body = await page.evaluate(`document.body.innerText.slice(0, 800)`);
  log(`Body preview: ${body.slice(0, 300)}`);

  // Try clicking the link by text
  const phoneLoginClicked = await page.evaluate(`
    (function() {
      var links = document.querySelectorAll('a, span, div, button');
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        if (el.textContent && el.textContent.includes('邮箱登录')) {
          el.click();
          return el.textContent.trim();
        }
      }
      return 'NOT FOUND';
    })()
  `);
  log(`Phone/email login click result: ${phoneLoginClicked}`);

  await page.waitForTimeout(3000);
  log(`URL after click: ${page.url()}`);

  const body2 = await page.evaluate(`document.body.innerText.slice(0, 800)`);
  log(`Body after click: ${body2.slice(0, 500)}`);

  // Step 3: If form appeared, fill it
  const hasEmailInput = await page.evaluate(`
    (function() {
      var inputs = document.querySelectorAll('input');
      var types = [];
      inputs.forEach(function(inp) { types.push(inp.type + ':' + (inp.placeholder || inp.name || inp.id)); });
      return JSON.stringify(types);
    })()
  `);
  log(`Input elements: ${hasEmailInput}`);

  log(`\nAll API requests: ${requests.length}`);
  requests.forEach(r => log(`  ${r}`));

  await page.screenshot({ path: "/tmp/apifox-email-login.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
