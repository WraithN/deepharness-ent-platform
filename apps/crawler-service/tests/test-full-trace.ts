/**
 * Capture ALL network activity. Check localStorage vs cookie token usage.
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

  // Inject token into localStorage too
  await ctx.addInitScript(`
    localStorage.setItem("authorization", "Bearer ${TOKEN}");
    localStorage.setItem("token", "${TOKEN}");
    localStorage.setItem("accessToken", "${TOKEN}");
  `);

  const page = await ctx.newPage();

  // Track ALL requests (not just /api/)
  const allReqs: Array<{ method: string; url: string; status: number; type: string; redirected: boolean }> = [];
  page.on("response", (res) => {
    allReqs.push({
      method: res.request().method(),
      url: res.url(),
      status: res.status(),
      type: res.request().resourceType(),
      redirected: res.request().isNavigationRequest(),
    });
  });

  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  log(`Loaded: ${page.url()}`);

  // Check what localStorage/cookies the app sees
  const lsAuth = await page.evaluate(`localStorage.getItem("authorization")`);
  const lsToken = await page.evaluate(`localStorage.getItem("token")`);
  const lsKeys = await page.evaluate(`JSON.stringify(Object.keys(localStorage).slice(0,30))`);
  const cookies = await ctx.cookies("https://app.apifox.com");

  log(`localStorage.authorization: ${lsAuth}`);
  log(`localStorage.token: ${lsToken}`);
  log(`localStorage keys (first 30): ${lsKeys}`);
  log("Cookies on .apifox.com: " + cookies.map(c => c.name + "=" + (c.value || "").slice(0, 20) + "...").join(", "));

  log(`\n=== ALL NETWORK REQUESTS (${allReqs.length}) ===`);
  // Show only interesting ones
  allReqs.forEach(r => {
    const u = r.url.slice(0, 200);
    if (r.status === 401 || r.status === 403 || r.url.includes("/user") || r.url.includes("/auth") || r.url.includes("/login") || r.type === "xhr" || r.type === "fetch") {
      log(`  ${r.method} [${r.status}] ${u} (${r.type})`);
    }
  });

  // Also show XHR/fetch calls specifically
  const apiCalls = allReqs.filter(r => r.type === "xhr" || r.type === "fetch");
  log(`\n=== XHR/FETCH REQUESTS (${apiCalls.length}) ===`);
  apiCalls.forEach(r => log(`  ${r.method} [${r.status}] ${r.url.slice(0, 200)}`));

  await page.screenshot({ path: "/tmp/apifox-full-trace.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
