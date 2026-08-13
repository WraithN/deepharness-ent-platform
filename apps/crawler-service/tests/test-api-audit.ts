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

  // Log ALL XHR/fetch API calls and their responses
  const apiCalls: Array<{ url: string; status: number; bodySnippet: string }> = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("api.apifox.com/api/")) {
      try {
        const body = await resp.text();
        apiCalls.push({
          url: url.replace("https://api.apifox.com", ""),
          status: resp.status(),
          bodySnippet: body.slice(0, 200),
        });
      } catch {}
    }
  });

  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  await page.waitForTimeout(10000);

  console.log(`\n=== API Calls (${apiCalls.length}) ===`);
  for (const call of apiCalls) {
    console.log(`  [${call.status}] ${call.url}`);
    console.log(`    body: ${call.bodySnippet.slice(0, 150)}`);
  }

  // Check localStorage keys
  const lsKeys = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key!);
      keys.push({ key, val: val!.slice(0, 100) });
    }
    return keys;
  });
  console.log("\n=== localStorage ===");
  lsKeys.forEach(k => console.log(`  ${k.key}: ${k.val}`));

  const url = page.url();
  console.log(`\nFinal URL: ${url}`);

  await browser.close();
}
main();
