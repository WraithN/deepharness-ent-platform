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

  // Log ALL network requests
  let requests: Array<{ url: string; method: string; status: number; type: string }> = [];
  page.on("request", (req) => requests.push({ url: req.url(), method: req.method(), status: 0, type: req.resourceType() }));
  page.on("response", (res) => {
    const existing = requests.find(r => r.url === res.url() && r.status === 0);
    if (existing) existing.status = res.status();
    else requests.push({ url: res.url(), method: "?", status: res.status(), type: "" });
  });

  // Capture console errors/warnings
  const consoleMessages: Array<{ type: string; text: string }> = [];
  page.on("console", (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));

  try {
    console.log("=== Loading page... ===");
    await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
      waitUntil: "domcontentloaded", timeout: 30000,
    });
    console.log("=== DOM loaded ===");

    // Check initial React state right after DOM load
    const initialCheck = await page.evaluate(() => ({
      bodyLen: document.body?.innerText?.length || 0,
      hasLogin: document.body?.innerText?.includes("登录") || false,
      APP_REGION: (window as any).APP_REGION,
      localStorage: Object.keys(localStorage).reduce((acc: any, k) => ({ ...acc, [k]: localStorage.getItem(k)?.slice(0, 100) }), {}),
    }));
    console.log("Initial state:", JSON.stringify(initialCheck, null, 2));

    // Wait for React to hydrate/route
    await page.waitForTimeout(5000);

    // Check loading state
    const loading = await page.evaluate(() => {
      const loader = document.querySelector(".apipost-loading");
      const spin = document.querySelector(".ant-spin");
      const skeleton = document.querySelector('[class*="skeleton"]');
      return { loader: !!loader, spin: !!spin, skeleton: !!skeleton };
    });
    console.log("Loading elements after 5s:", loading);
  } catch (e: any) {
    console.log(`ERROR: ${e.message}`);
  }

  // Wait more for full render
  await page.waitForTimeout(5000);

  const finalState = await page.evaluate(() => {
    const b = document.body?.innerText?.slice(0, 500) || "";
    const rect = document.body?.getBoundingClientRect();
    const rootEl = document.getElementById("root");
    const rootChildren = rootEl?.childElementCount || 0;
    const rootHTML = rootEl?.innerHTML?.slice(0, 300) || "";
    return { url: location.href, title: document.title, rect, rootChildren, rootHTML, bodyText: b.slice(0, 300) };
  });
  console.log("\nFinal state:", JSON.stringify(finalState, null, 2));

  // Print all network requests
  console.log(`\n=== Network (${requests.length} requests) ===`);
  requests.forEach(r => console.log(`  [${r.status}] ${r.method} ${r.type.padEnd(8)} ${r.url.slice(0, 120)}`));

  // Print console messages
  console.log(`\n=== Console (${consoleMessages.length} messages) ===`);
  consoleMessages.forEach(m => console.log(`  [${m.type}] ${m.text.slice(0, 200)}`));

  await browser.close();
}
main();
