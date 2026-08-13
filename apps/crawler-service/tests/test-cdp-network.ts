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

  // Set all token/localStorage keys
  await page.addInitScript((token) => {
    const encoded = JSON.stringify({ id: 3232299, name: "狐友UgzW", username: "狐友UgzW" });
    localStorage.setItem("userToken", token);
    localStorage.setItem("currentAccessToken", token);
    localStorage.setItem("user", encoded);
    localStorage.setItem("currentUser", encoded);
  }, TOKEN);

  // Intercept ALL fetch calls (unfiltered)
  await page.addInitScript(`
    const origFetch = window.fetch;
    let count = 0;
    window.fetch = function(...args) {
      count++;
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      console.log("[FETCH#" + count + "] " + url.slice(0, 200));
      return origFetch.apply(this, args);
    };
    console.log("[INIT] fetch interceptor installed");
  `);

  // Use CDP Network to capture ALL requests with headers
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const networkReqs: any[] = [];
  cdp.on("Network.requestWillBeSent", (params) => {
    const url = params.request.url;
    if (url.includes("apifox.com")) {
      networkReqs.push({
        url: url.replace("https://", "").slice(0, 120),
        method: params.request.method,
        auth: params.request.headers.Authorization?.slice(0, 60) || "none",
      });
    }
  });

  // Log ALL console messages
  const msgs: string[] = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[FETCH]") || t.includes("[INIT]") || msg.type() === "error") {
      msgs.push(`[${msg.type()}] ${t.slice(0, 250)}`);
    }
  });

  console.log("Loading page...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  console.log(`\n=== Console messages (${msgs.length}) ===`);
  msgs.forEach(m => console.log(`  ${m}`));

  console.log(`\n=== CDP Network requests (${networkReqs.length}) ===`);
  networkReqs.forEach(r => console.log(`  [${r.method}] ${r.url}  Auth: ${r.auth}`));

  console.log(`\nURL: ${page.url()}`);
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 200));
  console.log(`Body: "${body}"`);

  await browser.close();
}
main();
