/**
 * Capture ALL API requests during WeChat login flow — no mocking, just observation.
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
  await ctx.addInitScript(`
    (function() {
      var op = history.pushState;
      history.pushState = function(s,t,u) { if (String(u).includes("/user/login")) return; return op.apply(this,arguments); };
      var or_ = history.replaceState;
      history.replaceState = function(s,t,u) { if (String(u).includes("/user/login")) return; return or_.apply(this,arguments); };
    })()
  `);

  const page = await ctx.newPage();

  const requests: Array<{ method: string; url: string; body: string }> = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) {
      requests.push({ method: req.method(), url: req.url(), body: req.postData() || "" });
    }
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      const match = requests.find(r => r.url === res.url());
      if (match) {
        try {
          const body = await res.text();
          (match as any).status = res.status();
          (match as any).response = body.slice(0, 300);
        } catch(e) {}
      }
    }
  });

  log("Navigating...");
  await page.goto(TARGET, { waitUntil: "load", timeout: 30000 });
  log(`Loaded: ${page.url()}`);

  // Wait for WeChat QR polling to happen
  await page.waitForTimeout(20000);
  log(`After 20s: ${page.url()}`);

  // Dump all captured requests
  log(`\n=== ALL API REQUESTS (${requests.length}) ===`);
  requests.forEach(r => {
    log(`${r.method} ${r.url}`);
    try {
      const resp = JSON.parse(r.response || "{}");
      const keys = r.response ? Object.keys(resp).join(",") : "no resp";
      log(`  -> ${(r as any).status} | keys: ${keys} | resp: ${(r as any).response || "none".slice(0, 100)}`);
    } catch(e) {
      log(`  -> ${(r as any).status} | ${r.response ? r.response.slice(0, 100) : "no resp"}`);
    }
  });

  // Also check body content
  const body = await page.evaluate(`document.body ? document.body.innerText.slice(0, 500) : "no body"`);
  log(`\nBody: ${body.slice(0, 300)}`);

  await page.screenshot({ path: "/tmp/apifox-capture-only.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
