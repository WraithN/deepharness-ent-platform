import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
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

  await page.addInitScript((token) => {
    localStorage.setItem("userToken", token);
    localStorage.setItem("currentAccessToken", token);
    localStorage.setItem("user", JSON.stringify({ id: 3232299, name: "狐友UgzW", username: "狐友UgzW" }));
  }, TOKEN);

  // Log ALL API response bodies
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("api.apifox.com") && !url.includes("/static/") && !url.includes("/cdn/")) {
      try {
        const bodyText = await resp.text();
        console.log(`\n=== API: ${resp.request().method()} ${url.replace("https://", "").slice(0, 100)}`);
        console.log(`  Status: ${resp.status()}`);
        console.log(`  Body: ${bodyText.slice(0, 800)}`);
        if (bodyText.length > 800) console.log(`  ... (${bodyText.length} total bytes)`);
      } catch { /* ignore */ }
    }
  });

  // Also intercept route to see what happens
  await page.route("**/*", (route) => {
    const url = route.request().url();
    const pw = route.request().postDataJSON();
    if (url.includes("api.apifox.com") && !url.includes("/static/") && !url.includes("/cdn/")) {
      if (pw) console.log(`  PostData: ${JSON.stringify(pw).slice(0, 300)}`);
    }
    route.continue();
  });

  console.log("Loading page...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  console.log(`\n=== Final URL: ${page.url()}`);

  // Check document.cookie
  const cookies = await page.evaluate(() => document.cookie);
  console.log(`\n=== document.cookie: ${cookies.slice(0, 500)}`);

  // Check localStorage
  const ls = await page.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) items[k] = localStorage.getItem(k)?.slice(0, 100) || "";
    }
    return items;
  });
  console.log(`\n=== localStorage (${Object.keys(ls).length} keys):`);
  Object.entries(ls).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  await browser.close();
}
main();
