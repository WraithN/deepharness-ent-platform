import { firefox } from "playwright";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

async function main() {
  const browser = await firefox.launch({ headless: true, args: [] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);
  
  // Block redirects
  await ctx.addInitScript(`
    const _push = history.pushState;
    const _replace = history.replaceState;
    history.pushState = function(s,t,u) { if (typeof u==='string' && u.includes('/user/login')) return; return _push.call(this,s,t,u); };
    history.replaceState = function(s,t,u) { if (typeof u==='string' && u.includes('/user/login')) return; return _replace.call(this,s,t,u); };
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  `);

  const page = await ctx.newPage();
  
  try {
    await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
      waitUntil: "networkidle", timeout: 30000,
    });
    const url = page.url();
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300));
    const isLogin = bodyText.includes("微信扫码") || bodyText.includes("登录");
    console.log(`Firefox: URL=${url.includes("login") ? "❌LOGIN" : "✅APP"} | loginPage=${isLogin} | title="${title}"`);
    console.log(`Body: "${bodyText.slice(0, 200)}"`);
  } catch (e: any) {
    console.log(`Firefox ERROR: ${e.message}`);
  }
  await browser.close();
}
main();
