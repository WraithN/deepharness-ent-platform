import { chromium } from "playwright";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  const page = await ctx.newPage();

  // Intercept to check request cookies
  page.on("request", (req) => {
    if (req.url().includes("/main/teams/3883284")) {
      console.log("=== Initial HTML request headers ===");
      const h = req.headers();
      console.log("  Cookie:", h["cookie"]?.slice(0, 200));
      console.log("  User-Agent:", h["user-agent"]);
    }
  });

  const response = await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });

  console.log("\n=== Initial response headers ===");
  const resHeaders = response?.headers();
  if (resHeaders) {
    for (const [k, v] of Object.entries(resHeaders)) {
      console.log(`  ${k}: ${v.slice(0, 200)}`);
    }
  }

  // Check what cookies the browser reports
  const actualCookies = await ctx.cookies();
  console.log(`\n=== Browser cookies (${actualCookies.length}) ===`);
  actualCookies.filter(c => c.domain.includes("apifox")).forEach(c => {
    console.log(`  ${c.name || "?"}: ${c.value.slice(0, 80)} (domain=${c.domain}, path=${c.path}, httpOnly=${c.httpOnly}, secure=${c.secure}, sameSite=${c.sameSite})`);
  });

  // Check: are cookies sent on API calls?
  page.on("request", (req) => {
    if (req.url().includes("api.apifox.com") && req.url().includes("/api/v1/configs/client")) {
      console.log("\n=== API request headers (configs/client) ===");
      const h = req.headers();
      console.log("  Cookie:", h["cookie"]?.slice(0, 300) || "NONE");
      console.log("  Authorization:", h["authorization"] || "NONE");
    }
  });

  await page.waitForTimeout(10000);
  console.log(`\nFinal URL: ${page.url()}`);

  await browser.close();
}
main();
