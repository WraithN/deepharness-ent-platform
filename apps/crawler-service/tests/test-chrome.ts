import { chromium } from "playwright";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

async function run(label: string, opts: Record<string, any>) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"], ...opts });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);
  const page = await ctx.newPage();
  try {
    await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
      waitUntil: "networkidle", timeout: 15000,
    });
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 150));
    const isLogin = bodyText.includes("微信扫码");
    console.log(`[${label}] URL=${url.includes("login") ? "❌LOGIN" : "✅APP"} | login=${isLogin}`);
  } catch (e: any) {
    console.log(`[${label}] ERROR: ${e.message}`);
  }
  await browser.close();
}

async function main() {
  // Test 1: bundled Chromium
  await run("bundled   ", {});
  
  // Test 2: system Chromium
  await run("system    ", { executablePath: "/usr/sbin/chromium" });
}
main();
