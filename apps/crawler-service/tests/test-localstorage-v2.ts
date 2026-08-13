import { chromium } from "playwright";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

const FAKE_SEC_CH_UA = "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not=A?Brand\";v=\"24\"";

// User data from API
const USER_DATA = {
  id: 3232299,
  name: "狐友UgzW",
  avatar: "https://cdn.apifox.com/app/avatar/builtin/19.png",
  username: "狐友UgzW",
  employeeNumber: null,
  email: null,
  hasPassword: false,
  bio: "",
  mobile: null,
  features: {},
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  const page = await ctx.newPage();

  // CDP Fetch for sec-ch-ua override
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
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

  // Inject user data into localStorage via addInitScript (runs on target page origin)
  await page.addInitScript((userData) => {
    const encoded = JSON.stringify(userData);
    localStorage.setItem("user", encoded);
    localStorage.setItem("currentUser", encoded);
    localStorage.setItem("userInfo", encoded);
    localStorage.setItem("profile", encoded);
    localStorage.setItem("me", encoded);
    localStorage.setItem("af_user", encoded);
    console.log("[init] Set localStorage user keys");
  }, USER_DATA);

  // Block history redirect
  await page.addInitScript(`
    (function() {
      const origReplace = history.replaceState;
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

  // Log ALL API calls
  const apiCalls: Array<{ url: string; status: number }> = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("api.apifox.com/api/")) {
      apiCalls.push({ url: url.replace("https://api.apifox.com", ""), status: resp.status() });
    }
  });

  console.log("Navigating to main page...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  console.log(`\n=== API calls (${apiCalls.length}) ===`);
  apiCalls.forEach(c => console.log(`  [${c.status}] ${c.url}`));

  const url = page.url();
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
  console.log(`\nFinal URL: ${url}`);
  console.log(`Is login: ${url.includes("login")}`);
  console.log(`Body: "${body.slice(0, 300)}"`);

  // Check what localStorage looks like now
  const lsNow = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      keys.push(key);
    }
    return keys;
  });
  console.log(`\nlocalStorage keys: ${lsNow.join(", ")}`);

  await browser.close();
}
main();
