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
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);
  const page = await ctx.newPage();

  // No stealth. No overrides. No localStorage. No CDP. Just listen.

  const apiCalls: Array<{ url: string; status: number }> = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("api.apifox.com/api/")) {
      apiCalls.push({ url: url.replace("https://api.apifox.com", ""), status: resp.status() });
    }
    if (url.includes(".js") && url.includes("app.apifox.com")) {
      apiCalls.push({ url: url.replace("https://app.apifox.com", "").slice(0, 100), status: resp.status() });
    }
  });

  // Wait for React to load
  page.on("console", (msg) => {
    if (msg.type() === "log" || msg.type() === "error") {
      const t = msg.text();
      if (t.length < 300) console.log(`  [${msg.type()}] ${t}`);
    }
  });

  console.log("Goto with networkidle (up to 60s)...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  // Check React status
  const reactStatus = await page.evaluate(() => {
    const hasFiber = (document.body.outerHTML.match(/react-/g) || []).length;
    const rootEl = document.getElementById("root");
    const rootHTML = rootEl?.outerHTML?.slice(0, 500) || "no root";
    const children = rootEl?.children?.length || 0;
    return { hasFiber, children, rootHTML };
  });

  console.log(`\nAPI calls: ${apiCalls.length}`);
  apiCalls.forEach(c => console.log(`  [${c.status}] ${c.url}`));

  console.log(`\n=== React status ===`);
  console.log(`Fiber count: ${reactStatus.hasFiber}`);
  console.log(`Root children: ${reactStatus.children}`);
  console.log(`Root HTML: ${reactStatus.rootHTML?.slice(0, 300)}`);

  const url = page.url();
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 300));
  console.log(`URL: ${url}`);
  console.log(`Body: "${body}"`);

  await browser.close();
}
main();
