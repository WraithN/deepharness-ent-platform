/**
 * Find the specific "手机号/邮箱登录" clickable element using precise selectors.
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
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Find elements containing "邮箱登录" with their tag/class/hierarchy
  const elemInfo = await page.evaluate(`
    (function() {
      function getPath(el) {
        var path = [];
        var cur = el;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          var tag = cur.tagName ? cur.tagName.toLowerCase() : 'text';
          var cls = cur.className;
          if (typeof cls !== 'string') cls = '';
          var id = cur.id || '';
          var label = tag;
          if (id) label += '#' + id;
          if (cls) label += '.' + cls.split(' ').slice(0,3).join('.');
          path.unshift(label);
          cur = cur.parentElement;
        }
        return path.join(' > ');
      }

      // Walk ALL text nodes looking for "邮箱登录"
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var results = [];
      var node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('邮箱登录')) {
          var el = node.parentElement;
          var tag = el.tagName.toLowerCase();
          var cls = (el.className && typeof el.className === 'string') ? el.className : '';
          var id = el.id || '';
          var attrs = [];
          if (el.getAttribute('role')) attrs.push('role=' + el.getAttribute('role'));
          if (el.getAttribute('tabindex')) attrs.push('tabindex=' + el.getAttribute('tabindex'));
          if (el.getAttribute('data-node-key')) attrs.push('data-node-key=' + el.getAttribute('data-node-key'));
          if (el.onclick) attrs.push('has-onclick');
          var text = node.textContent.trim().slice(0, 50);
          results.push({
            text: text,
            tag: tag,
            class: cls.slice(0, 100),
            id: id,
            attrs: attrs.join(', '),
            innerHTML: el.innerHTML.slice(0, 200),
            path: getPath(el).slice(0, 200),
            hasClick: !!el.onclick || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'tab' || tag === 'a' || tag === 'button',
          });
        }
      }
      return JSON.stringify(results, null, 2);
    })()
  `);
  log(`Elements containing "邮箱登录":`);
  log(elemInfo);

  // Try Playwright's precise locators
  log("\n=== Trying Playwright locators ===");

  // Method 1: Exact text match
  const exactMatch = page.locator('text="手机号/邮箱登录"');
  const exactCount = await exactMatch.count();
  log(`text="手机号/邮箱登录" count: ${exactCount}`);

  // Method 2: Button with text
  const btnMatch = page.locator('button:has-text("邮箱登录"), a:has-text("邮箱登录")');
  const btnCount = await btnMatch.count();
  log(`button/a with "邮箱登录": ${btnCount}`);

  // Method 3: Span/div with exact text
  const spanMatch = page.locator('span:text-is("手机号/邮箱登录")');
  const spanCount = await spanMatch.count();
  log(`span:text-is count: ${spanCount}`);

  // Method 4: Any element where text starts with it
  const startMatch = page.getByText('手机号/邮箱登录', { exact: true });
  const startCount = await startMatch.count();
  log(`getByText exact: ${startCount}`);

  // Method 5: Role tab
  const tabMatch = page.getByRole('tab', { name: /邮箱登录|手机号/ });
  const tabCount = await tabMatch.count();
  log(`role=tab with text: ${tabCount}`);

  // If we found a specific element, try clicking it
  if (btnCount > 0) {
    await btnMatch.first().click();
    log("Clicked button/a with 邮箱登录");
    await page.waitForTimeout(3000);
    const body2 = await page.evaluate(`document.body.innerText.slice(0, 500)`);
    log(`Body after click: ${body2}`);
  } else if (exactCount > 0) {
    await exactMatch.first().click();
    log("Clicked exact text match");
    await page.waitForTimeout(3000);
    const body2 = await page.evaluate(`document.body.innerText.slice(0, 500)`);
    log(`Body after click: ${body2}`);
  } else if (spanCount > 0) {
    await spanMatch.first().click();
    log("Clicked span exact text");
    await page.waitForTimeout(3000);
    const body2 = await page.evaluate(`document.body.innerText.slice(0, 500)`);
    log(`Body after click: ${body2}`);
  } else if (tabCount > 0) {
    await tabMatch.first().click();
    log("Clicked tab");
    await page.waitForTimeout(3000);
    const body2 = await page.evaluate(`document.body.innerText.slice(0, 500)`);
    log(`Body after click: ${body2}`);
  } else {
    log("No specific clickable element found for 邮箱登录");
  }

  await page.screenshot({ path: "/tmp/apifox-email-search.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
