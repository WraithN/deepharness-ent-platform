import { chromium } from "playwright";
import stealthInitScript from "./services/stealth-script.js";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--use-angle=swiftshader", // Why: we override WebGL anyway, but keep consistent
    ],
  });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
    permissions: [], // Don't auto-deny permissions
  });
  await ctx.addCookies(COOKIES);

  // Inject comprehensive stealth
  await ctx.addInitScript({ content: stealthInitScript });

  const page = await ctx.newPage();

  // Block history redirects as safety net
  await page.addInitScript(`
    const _origPush = history.pushState;
    const _origReplace = history.replaceState;
    history.pushState = function(state, title, url) {
      if (typeof url === "string" && url.includes("/user/login")) return;
      return _origPush.call(this, state, title, url);
    };
    history.replaceState = function(state, title, url) {
      if (typeof url === "string" && url.includes("/user/login")) return;
      return _origReplace.call(this, state, title, url);
    };
  `);

  // Network-level block as additional safety
  await page.route("**/user/login**", (route) => route.abort());
  await page.route("**/user/sign-in**", (route) => route.abort());

  try {
    await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
      waitUntil: "networkidle", timeout: 30000,
    });

    const url = page.url();
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    const isLogin = bodyText.includes("微信扫码") || bodyText.includes("登录") || bodyText.includes("Scan the");

    console.log(`URL: ${url}`);
    console.log(`Title: "${title}"`);
    console.log(`Is login page: ${isLogin}`);
    console.log(`Body length: ${bodyText.length}`);
    console.log(`Body preview: "${bodyText.slice(0, 300)}"`);

    if (!isLogin) {
      // Success! Check actual rendered content
      const appCheck = await page.evaluate(() => {
        const b = document.body?.innerText || "";
        const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4")).map(e => e.textContent?.trim()).filter(Boolean);
        return { headings: headings.slice(0, 10), hasProjects: /项目|project/i.test(b), hasApi: /API|接口/i.test(b), hasTeam: /团队|team/i.test(b) };
      });
      console.log(`App content: ${JSON.stringify(appCheck)}`);
    }
  } catch (e: any) {
    console.log(`ERROR: ${e.message}`);
  }
  await browser.close();
}
main();
