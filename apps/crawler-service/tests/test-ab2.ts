import { chromium } from "playwright";

const STEALTH = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: { id: 'cpmheoeobamkdpnoeebmjonebmgobkgh' }, loadTimes: () => ({}), csi: () => ({}), app: {} };
  Object.defineProperty(navigator, 'userAgentData', { get: () => ({ brands: [{brand:'Google Chrome',version:'131'},{brand:'Chromium',version:'131'},{brand:'Not A;Brand',version:'24'}], mobile: false, platform: 'Windows' }) });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
`;

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

async function runTest(label: string, stealth: boolean) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);
  if (stealth) await ctx.addInitScript(STEALTH);
  
  const page = await ctx.newPage();
  try {
    await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
      waitUntil: "domcontentloaded", timeout: 15000,
    });
    await page.waitForTimeout(10000);
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300));
    const hasLogin = bodyText.includes("登录") && bodyText.includes("欢迎使用 Apifox");
    const isLoginUrl = url.includes("/user/login");
    console.log(`[${label}] URL=${isLoginUrl ? "❌LOGIN" : "✅APP"} | loginContent=${hasLogin} | body: "${bodyText.slice(0,80)}"`);
  } catch (e: any) {
    console.log(`[${label}] ERROR: ${e.message}`);
  }
  await browser.close();
}

async function main() {
  await runTest("NO stealth ", false);
  await runTest("WITH stealth", true);
}
main();
