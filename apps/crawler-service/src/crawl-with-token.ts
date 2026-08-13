/**
 * Token-based Apifox crawler.
 * Injects a real access token directly into localStorage (AES-encrypted),
 * skipping the login flow entirely. All API calls go to the real server.
 *
 * Usage:
 *   npx tsx src/crawl-with-token.ts <accessToken>
 *
 * The accessToken can be obtained from browser DevTools:
 *   localStorage.getItem('common.at.sig')  (encrypted form)
 *   OR just use the raw token value (this script will encrypt it)
 */
import CryptoJS from "crypto-js";
import { chromium } from "playwright";

const AES_KEY = "fZCLccxMini+9pjdvDsZdzedz7DwC2kH4TpBVzN16jQ";
const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  const rawToken = process.argv[2];
  if (!rawToken) {
    console.error("Usage: npx tsx src/crawl-with-token.ts <accessToken>");
    console.error("  Get your token from browser DevTools: localStorage.getItem('common.at.sig')");
    console.error("  Or provide the raw token value.");
    process.exit(1);
  }

  // Determine if the token is already encrypted (starts with "U2FsdGVk") or raw
  const isEncrypted = rawToken.startsWith("U2FsdGVk");
  const encryptedToken = isEncrypted ? rawToken : CryptoJS.AES.encrypt(rawToken, AES_KEY).toString();

  log(`Token mode: ${isEncrypted ? "pre-encrypted" : "raw -> encrypted"}`);
  log(`Encrypted token: ${encryptedToken.slice(0, 30)}...`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  const page = await ctx.newPage();

  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") log(`CONSOLE: ${msg.text().slice(0, 300)}`);
  });

  // Block tracking endpoints
  await page.route("http://121.199.72.199/**", async (route) => route.abort());

  // Inject token into localStorage BEFORE the page loads
  await page.addInitScript((encryptedToken) => {
    localStorage.setItem("common.at.sig", JSON.stringify(encryptedToken));
    localStorage.setItem("common.accessToken", JSON.stringify("hidden"));
    localStorage.setItem("common.currentUserId", JSON.stringify(3232299));
    localStorage.setItem(
      "LastLoginInfo",
      btoa(JSON.stringify({ type: "EmailPassword", account: "user@apifox.com" }))
    );
  }, encryptedToken);

  // Log all API calls (but don't mock them - let them go to the real server)
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const path = url.replace("https://api.apifox.com", "");
    log(`[API] ${method} ${path.slice(0, 120)}`);
    return route.continue();
  });

  log("Navigating to target page...");
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  log(`URL: ${page.url()}`);
  log(`Title: ${await page.title()}`);

  const body = await page.evaluate(
    "document.body ? document.body.innerText.slice(0, 5000) : 'no body'"
  );
  log(`\n=== PAGE CONTENT ===\n${body || "(empty)"}`);

  // Extract clickable elements
  const clickables = await page.evaluate(
    "(() => { const els = document.querySelectorAll('a, button, [role=tab]'); return Array.from(els).slice(0, 30).map(e => ({ tag: e.tagName, text: e.textContent?.trim().slice(0, 50), href: e.getAttribute('href') || '' })); })()"
  );
  log(`\n=== CLICKABLES ===\n${JSON.stringify(clickables, null, 2)}`);

  await page.screenshot({ path: "/tmp/apifox-token-crawl.png", fullPage: true });
  log("Screenshot saved to /tmp/apifox-token-crawl.png");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
