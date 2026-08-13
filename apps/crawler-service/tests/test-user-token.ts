import { chromium } from "playwright";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);
  const page = await ctx.newPage();

  // Set localStorage userToken (React checks this for auth)
  await page.addInitScript(`
    localStorage.setItem("userToken", "zvtv41oRso6Q23joZth0xHM7ugfBRT9k");
    console.log("[init] Set localStorage.userToken");
  `);

  // Log API calls
  const apiCalls: string[] = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("api.apifox.com/api/")) {
      apiCalls.push(`${resp.status()} ${url.replace("https://api.apifox.com", "").slice(0, 100)}`);
    }
  });

  page.on("console", (msg) => {
    const t = msg.text();
    if (msg.type() === "error" || (msg.type() === "log" && t.includes("init"))) {
      console.log(`  [${msg.type()}] ${t.slice(0, 200)}`);
    }
  });

  console.log("Loading with userToken in localStorage...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  console.log(`\nAPI calls (${apiCalls.length}):`);
  apiCalls.forEach(c => console.log(`  ${c}`));

  const url = page.url();
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 400));
  console.log(`\nURL: ${url}`);
  console.log(`Body: "${body}"`);
  console.log(`Is login page: ${url.includes("login") || body.includes("微信扫码")}`);

  // Check rendered React root content
  const domSnapshot = await page.evaluate(() => {
    const root = document.getElementById("root");
    const hasUserMenu = document.querySelector("[class*='user']") || document.querySelector("[class*='avatar']");
    const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map(h => h.textContent?.slice(0, 50));
    return {
      rootChildCount: root?.children?.length || 0,
      hasUserMenu: !!hasUserMenu,
      headings: headings.slice(0, 10),
      bodyClasses: document.body.className,
    };
  });
  console.log(`\nDOM:`, JSON.stringify(domSnapshot, null, 2));

  await browser.close();
}
main();
