import { chromium } from "playwright";

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

  // CDP Fetch domain: intercept ALL requests at network level
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }],
  });

  let headerLogged = false;
  cdp.on("Fetch.requestPaused", async (params) => {
    const headers = { ...params.request.headers };

    if (headers["sec-ch-ua"] && headers["sec-ch-ua"].includes("HeadlessChrome")) {
      headers["sec-ch-ua"] = FAKE_SEC_CH_UA;
      if (!headerLogged) {
        console.log("[Fetch] Overrode sec-ch-ua for:", params.request.url.slice(0, 80));
        headerLogged = true;
      }
    }
    if (headers["sec-ch-ua-mobile"]) headers["sec-ch-ua-mobile"] = "?0";
    if (headers["sec-ch-ua-platform"]) headers["sec-ch-ua-platform"] = "\"Windows\"";

    await cdp.send("Fetch.continueRequest", {
      requestId: params.requestId,
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    });
  });

  // Verify with Network domain too
  let netLogged = false;
  cdp.on("Network.requestWillBeSent", (params) => {
    if (!netLogged && params.request.url.includes("apifox.com/main/teams")) {
      console.log("[Network] ACTUAL sec-ch-ua:", params.request.headers["sec-ch-ua"]);
      netLogged = true;
    }
  });
  await cdp.send("Network.enable");

  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  await page.waitForTimeout(10000);

  const url = page.url();
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 200));
  console.log(`\nFinal URL: ${url}`);
  console.log(`Is login: ${url.includes("login")}`);
  console.log(`Body: "${body.slice(0, 150)}"`);

  await browser.close();
}
main();
