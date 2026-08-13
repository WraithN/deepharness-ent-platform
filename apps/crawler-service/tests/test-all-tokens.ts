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

  // Set ALL possible auth-related localStorage keys
  await page.addInitScript((token) => {
    const keys = ["userToken", "currentAccessToken", "token", "accessToken", "apifox_token", "Authorization", "user"];
    for (const k of keys) {
      localStorage.setItem(k, token);
    }
    // Also try with Bearer prefix
    localStorage.setItem("userToken_v2", `Bearer ${token}`);
    console.log("[init] Set all token localStorage keys");
  }, TOKEN);

  // Also inject user data
  await page.addInitScript(`
    const userData = JSON.stringify({ id: 3232299, name: "狐友UgzW", username: "狐友UgzW" });
    localStorage.setItem("user", userData);
    localStorage.setItem("currentUser", userData);
    localStorage.setItem("userInfo", userData);
    localStorage.setItem("af_user", userData);
    localStorage.setItem("profile", userData);
    console.log("[init] Set user localStorage keys");
  `);

  // Block login redirect
  await page.addInitScript(`
    (function() {
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      const block = function() {
        const url = arguments[2];
        if (typeof url === "string" && url.includes("/user/login")) {
          console.log("[stealth] BLOCKED redirect to " + url);
          return;
        }
        return origPush.apply(history, arguments);
      };
      history.pushState = block;
      const block2 = function() {
        const url = arguments[2];
        if (typeof url === "string" && url.includes("/user/login")) {
          console.log("[stealth] BLOCKED redirect to " + url);
          return;
        }
        return origReplace.apply(history, arguments);
      };
      history.replaceState = block2;
    })();
  `);

  const apiCalls: string[] = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("api.apifox.com/api/")) {
      apiCalls.push(`${resp.status()} ${url.replace("https://api.apifox.com", "").slice(0, 120)}`);
    }
  });

  page.on("console", (msg) => {
    const t = msg.text();
    if (msg.type() === "error" || t.includes("[init]") || t.includes("[stealth]")) {
      console.log(`  [${msg.type()}] ${t.slice(0, 250)}`);
    }
  });

  console.log("Loading with ALL tokens + user data + history block...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  console.log(`\nAPI calls (${apiCalls.length}):`);
  apiCalls.forEach(c => console.log(`  ${c}`));

  const url = page.url();
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
  console.log(`\nURL: ${url}`);
  console.log(`Body: "${body}"`);

  // Check localStorage content after page load
  const ls = await page.evaluate(() => {
    const result: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      result[key] = localStorage.getItem(key)!.slice(0, 100);
    }
    return result;
  });
  console.log("\nlocalStorage after load:");
  for (const [k, v] of Object.entries(ls)) {
    console.log(`  ${k}: ${v}`);
  }

  await browser.close();
}
main();
