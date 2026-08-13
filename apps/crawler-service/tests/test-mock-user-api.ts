import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];

const FAKE_USER = { id: 3232299, name: "狐友UgzW", username: "狐友UgzW", email: "huu@example.com" };

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
    localStorage.setItem("currentUser", JSON.stringify({ id: 3232299, name: "狐友UgzW", username: "狐友UgzW" }));
  }, TOKEN);

  // Intercept /api/v1/user and /api/v1/currentUser to return user data
  await page.route("**/api/v1/user**", (route) => {
    console.log(`[ROUTE] Intercepted user API: ${route.request().method()} ${route.request().url()}`);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: FAKE_USER }) });
  });

  await page.route("**/api/v1/currentUser**", (route) => {
    console.log(`[ROUTE] Intercepted currentUser API: ${route.request().method()} ${route.request().url()}`);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: FAKE_USER }) });
  });

  // Also mock /api/v1/configs/client to include user data
  await page.route("**/api/v1/configs/client**", async (route) => {
    const resp = await route.fetch();
    const body = await resp.json();
    console.log(`[ROUTE] configs/client - injecting user data`);
    body.data.user = FAKE_USER;
    body.data.isLogin = true;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  // ALSO mock common user endpoints
  const userEndpoints = ["**/api/v1/users/me**", "**/api/v1/auth/current**", "**/api/v1/profile**"];
  for (const ep of userEndpoints) {
    await page.route(ep, (route) => {
      console.log(`[ROUTE] Intercepted: ${ep}`);
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: FAKE_USER }) });
    });
  }

  console.log("Loading page...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  console.log(`\n=== URL: ${page.url()}`);

  // Check what React rendered
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300));
  console.log(`\n=== Body: "${bodyText}"`);

  // Wait a bit more and check again
  await page.waitForTimeout(5000);

  const bodyText2 = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
  console.log(`\n=== Body (after 5s): "${bodyText2}"`);

  console.log(`\n=== URL (after 5s): ${page.url()}`);

  await browser.close();
}
main();
