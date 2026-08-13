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

  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });

  // Check cookies visible to JS
  const jsCookies = await page.evaluate(() => document.cookie);
  console.log(`document.cookie: "${jsCookies.slice(0, 300)}"`);

  // Hook into React to detect state changes
  await page.evaluate(`
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    let firstRedirect = true;
    history.pushState = function(s, t, u) {
      if (firstRedirect) {
        console.warn("[INTERCEPT] pushState:", u);
        console.warn("[INTERCEPT] document.cookie:", document.cookie.slice(0, 200));
        firstRedirect = false;
      }
      return origPush.call(this, s, t, u);
    };
    history.replaceState = function(s, t, u) {
      if (firstRedirect) {
        console.warn("[INTERCEPT] replaceState:", u);
        console.warn("[INTERCEPT] document.cookie:", document.cookie.slice(0, 200));
        firstRedirect = false;
      }
      return origReplace.call(this, s, t, u);
    };
  `);

  // Capture console
  page.on("console", (msg) => {
    if (msg.text().includes("[INTERCEPT]")) console.log("CONSOLE:", msg.text());
  });

  await page.waitForTimeout(10000);

  const url = page.url();
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200));
  console.log(`Final URL: ${url}`);
  console.log(`Body: "${bodyText}"`);

  await browser.close();
}
main();
