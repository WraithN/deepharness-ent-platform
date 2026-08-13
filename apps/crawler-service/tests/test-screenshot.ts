import { chromium } from "playwright";
import stealthInitScript from "./services/stealth-script.js";
import path from "path";

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

  // CDP Fetch to override sec-ch-ua
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

  await page.addInitScript(stealthInitScript);
  await page.addInitScript(`
    (function() {
      const origReplace = history.replaceState;
      history.replaceState = function() {
        const url = arguments[2];
        if (typeof url === "string" && url.includes("/user/login")) return;
        return origReplace.apply(history, arguments);
      };
    })();
  `);

  console.log("Navigating...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  await page.waitForTimeout(10000);

  // Screenshot
  const screenshotPath = path.resolve("/tmp/apifox-combined-screenshot.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Screenshot saved: ${screenshotPath}`);

  // Dom structure analysis
  const domInfo = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;

    // Find root divs (React mount points)
    const rootDivs = Array.from(body.querySelectorAll("div[id]")).filter(d => d.children.length > 0);
    const rootInfo = rootDivs.map(d => ({
      id: d.id,
      class: d.className?.toString()?.slice(0, 80),
      children: d.children.length,
      visible: d.offsetParent !== null,
      text: d.innerText?.slice(0, 80),
    }));

    // Check for login-related elements
    const loginElements = body.querySelectorAll('[class*="login"], [class*="Login"], [class*="user-login"]');
    const loginInfo = Array.from(loginElements).slice(0, 3).map(el => ({
      tag: el.tagName,
      class: el.className?.toString()?.slice(0, 80),
      text: el.innerText?.slice(0, 60),
      visible: el.offsetParent !== null,
    }));

    // Check for app layout elements
    const appElements = body.querySelectorAll('[class*="AppLayout"], [class*="main-content"], [class*="team"], [class*="project"]');
    const appInfo = Array.from(appElements).slice(0, 5).map(el => ({
      tag: el.tagName,
      class: el.className?.toString()?.slice(0, 80),
      text: el.innerText?.slice(0, 60),
      visible: el.offsetParent !== null,
    }));

    return {
      bodyChildren: body.children.length,
      rootDivs: rootInfo,
      loginElements: loginInfo,
      appElements: appInfo,
      bodyTextStart: document.body?.innerText?.slice(0, 100),
    };
  });

  console.log(`\n=== DOM Analysis ===`);
  console.log(`Body children: ${domInfo.bodyChildren}`);
  console.log(`Body text start: "${domInfo.bodyTextStart}"`);
  console.log(`\nRoot divs with id:`);
  domInfo.rootDivs.forEach(r => console.log(`  id="${r.id}" class="${r.class}" visible=${r.visible} text="${r.text}"`));

  console.log(`\nLogin elements:`);
  domInfo.loginElements.forEach(e => console.log(`  ${e.tag} class="${e.class}" visible=${e.visible} text="${e.text}"`));

  console.log(`\nApp elements:`);
  domInfo.appElements.forEach(e => console.log(`  ${e.tag} class="${e.class}" visible=${e.visible} text="${e.text}"`));

  const url = page.url();
  console.log(`\nFinal URL: ${url}`);

  await browser.close();
}
main();
