/**
 * Test: mock configs/client to include currentUser.
 * Also check if UMI bootstraps initial state in window.
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

  // Approach 1: Mock configs/client to include currentUser
  const FAKE_USER = {
    id: 3232299,
    username: "testuser",
    name: "Test User",
    email: "test@apifox.com",
    phone: "13800138000",
    avatar: "",
    role: "owner",
  };

  await page.route("**/api/v1/configs/client?*", async (route) => {
    const realResponse = await route.fetch();
    const body = JSON.parse(await realResponse.text());
    // Inject currentUser into configs response
    body.data.currentUser = FAKE_USER;
    body.data.wechatSupportEnable = false; // disable WeChat login
    log(`[MOCK] configs/client: injected currentUser, disabled wechat`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  // Approach 2: Also mock configs/url (pass through)
  await page.route("**/api/v1/configs/url?*", async (route) => {
    await route.continue();
  });

  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));

  // Check UMI bootstrapping data
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });
  
  // Check for embedded initial state in HTML or window
  const windowGlobals = await page.evaluate(`
    (function() {
      var keys = Object.keys(window).filter(function(k) {
        return k.indexOf('initial') !== -1 || k.indexOf('umi') !== -1 || k.indexOf('dva') !== -1 || k.indexOf('g_') === 0 || k.indexOf('__') === 0;
      });
      return JSON.stringify(keys.slice(0, 30));
    })()
  `);
  log(`\nWindow globals matching initial/umi/dva: ${windowGlobals}`);

  // Check for JSON in <script> tags (embedded data)
  const embeddedData = await page.evaluate(`
    (function() {
      var scripts = document.querySelectorAll('script[id*="initial"], script[type="application/json"]');
      var ids = [];
      scripts.forEach(function(s) { ids.push(s.id || s.type); });
      return JSON.stringify(ids);
    })()
  `);
  log(`Embedded data scripts: ${embeddedData}`);

  await page.waitForTimeout(5000);
  log(`\nFinal URL: ${page.url()}`);
  
  const title = await page.title();
  const body = await page.evaluate(`document.body ? document.body.innerText.slice(0, 800) : "no body"`);
  log(`Title: ${title}`);
  log(`Body (first 600):`);
  log(body.slice(0, 600));

  await page.screenshot({ path: "/tmp/apifox-config-inject.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
