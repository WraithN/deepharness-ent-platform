import { chromium } from "playwright";
import stealthInitScript from "./services/stealth-script.js";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

const FAKE_SEC_CH_UA = "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not=A?Brand\";v=\"24\"";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  const page = await ctx.newPage();

  // CDP Fetch domain to override sec-ch-ua at HTTP level
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }],
  });
  cdp.on("Fetch.requestPaused", async (params) => {
    const headers = { ...params.request.headers };
    if (headers["sec-ch-ua"]) headers["sec-ch-ua"] = FAKE_SEC_CH_UA;
    if (headers["sec-ch-ua-mobile"]) headers["sec-ch-ua-mobile"] = "?0";
    if (headers["sec-ch-ua-platform"]) headers["sec-ch-ua-platform"] = "\"Windows\"";
    await cdp.send("Fetch.continueRequest", {
      requestId: params.requestId,
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    });
  });

  // Inject stealth script BEFORE page scripts run
  await page.addInitScript(stealthInitScript);

  // Block history API to prevent URL-based redirect
  await page.addInitScript(`
    (function() {
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function() {
        console.log("[stealth] pushState", arguments);
        return origPush.apply(history, arguments);
      };
      history.replaceState = function() {
        const url = arguments[2];
        if (typeof url === "string" && url.includes("/user/login")) {
          console.log("[stealth] BLOCKED replaceState to login");
          return;
        }
        return origReplace.apply(history, arguments);
      };
    })();
  `);

  // Log navigator.userAgentData to verify stealth
  await page.addInitScript(`
    (function() {
      console.log("[stealth-verify] userAgentData:", JSON.stringify(navigator.userAgentData));
      console.log("[stealth-verify] webdriver:", navigator.webdriver);
      console.log("[stealth-verify] plugins.length:", navigator.plugins.length);
      console.log("[stealth-verify] platform:", navigator.platform);
    })();
  `);

  console.log("Navigating...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });

  await page.waitForTimeout(10000);

  const url = page.url();
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
  const bodyHtml = await page.evaluate(() => document.body?.innerHTML?.slice(0, 1000));

  console.log(`\n=== RESULT ===`);
  console.log(`Final URL: ${url}`);
  console.log(`Is login: ${url.includes("login")}`);
  console.log(`Body text: "${body.slice(0, 200)}"`);

  // Check if we see the main app layout or login page
  const isMainApp = await page.evaluate(() => {
    return !!document.querySelector('[class*="AppLayout"]') ||
           !!document.querySelector('[class*="main"]');
  });
  console.log(`Has AppLayout/main: ${isMainApp}`);

  const htmlLength = await page.evaluate(() => document.documentElement.outerHTML.length);
  console.log(`HTML length: ${htmlLength}`);

  await browser.close();
}
main();
