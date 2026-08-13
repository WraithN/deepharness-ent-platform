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

  // Catch ALL errors
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`PageError: ${err.message.slice(0, 200)}`));
  page.on("console", (msg) => {
    const t = msg.text().slice(0, 300);
    if (msg.type() === "error" || (msg.type() === "warning" && t.length < 200)) {
      errors.push(`Console[${msg.type()}]: ${t}`);
    }
  });
  page.on("requestfailed", (req) => {
    if (req.failure()) errors.push(`RequestFailed: ${req.url().slice(0, 150)} — ${req.failure()!.errorText}`);
  });

  console.log("Loading page (wait for load event)...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "load", timeout: 60000,
  });
  // Extra wait for JS execution
  await page.waitForTimeout(10000);

  console.log(`\n=== Errors (${errors.length}) ===`);
  errors.slice(0, 30).forEach(e => console.log(`  ${e}`));

  // Check what JS files loaded
  const jsFiles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("script[src]"))
      .map(s => (s as HTMLScriptElement).src.replace("https://app.apifox.com", "").slice(0, 120));
  });
  console.log(`\n=== JS files (${jsFiles.length}) ===`);
  jsFiles.slice(0, 20).forEach(f => console.log(`  ${f}`));

  // Check if React is available globally
  const reactGlobal = await page.evaluate(() => {
    if (typeof (window as any).React !== "undefined") return "window.React exists";
    if (typeof (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined") return "React DevTools hook exists";
    const root = document.getElementById("root");
    if (!root) return "no root element";
    const reactKeys = Object.keys(root).filter(k => k.startsWith("__react") || k.includes("React") || k.includes("fiber"));
    return reactKeys.length > 0 ? `root has React keys: ${reactKeys.join(", ")}` : "no React on root";
  });
  console.log(`\nReact detection: ${reactGlobal}`);

  // Full page source (first 5K)
  const source = await page.content();
  console.log(`\nPage HTML size: ${source.length}`);
  console.log(`Contains "react" (case-insensitive): ${source.toLowerCase().includes("react")}`);
  console.log(`Contains "login" (case-insensitive): ${source.toLowerCase().includes("login")}`);

  const url = page.url();
  console.log(`\nFinal URL: ${url}`);
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 200));
  console.log(`Body: "${body}"`);

  await browser.close();
}
main();
