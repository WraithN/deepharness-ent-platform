import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);
  const page = await ctx.newPage();

  try {
    await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
      waitUntil: "networkidle", timeout: 20000,
    });
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300));
    const isLogin = bodyText.includes("微信扫码") || bodyText.includes("欢迎使用 Apifox");
    const isLoginUrl = url.includes("/user/login");
    const title = await page.title();

    console.log(`URL=${isLoginUrl ? "❌LOGIN" : "✅APP"} | loginPage=${isLogin} | title="${title}"`);
    console.log(`Body: "${bodyText.slice(0, 200)}"`);

    // Check if actual app content is present
    const appCheck = await page.evaluate(() => {
      const b = document.body?.innerText || "";
      return { hasProjects: /项目|project/i.test(b), hasApi: /API|接口/i.test(b), len: b.length };
    });
    console.log(`App check: ${JSON.stringify(appCheck)}`);
  } catch (e: any) {
    console.log(`ERROR: ${e.message}`);
  }
  await browser.close();
}
main();
