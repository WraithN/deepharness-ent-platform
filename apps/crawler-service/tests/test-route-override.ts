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

  // Intercept and override sec-ch-ua headers
  let overriddenCount = 0;
  await page.route("**/*", async (route) => {
    const headers = await route.request().allHeaders();
    const hadSECH = "sec-ch-ua" in headers;
    headers["sec-ch-ua"] = FAKE_SEC_CH_UA;
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = "\"Windows\"";
    if (hadSECH && overriddenCount < 3) {
      console.log(`[override] ${route.request().url().slice(0, 80)}`);
      overriddenCount++;
    }
    await route.continue({ headers });
  });

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
