import { chromium } from "playwright";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

async function main() {
  // NO --disable-features=UserAgentClientHint
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=UserAgentClientHint",
    ],
  });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  const page = await ctx.newPage();

  // Log all sec-ch-ua headers
  await page.route("**/*", (route, req) => {
    const url = route.request().url();
    const headers = route.request().headers();
    if (headers["sec-ch-ua"] || headers["user-agent"]?.includes("Headless")) {
      console.log(`sec-ch-ua: ${headers["sec-ch-ua"] || "NONE"}`);
      console.log(`       url: ${url.slice(0, 100)}`);
    }
    route.continue();
  });

  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  await page.waitForTimeout(8000);

  const url = page.url();
  console.log(`\nFinal URL: ${url}`);
  console.log(`Is login: ${url.includes("login")}`);

  await browser.close();
}
main();
