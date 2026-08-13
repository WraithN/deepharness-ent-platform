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

  // Intercept configs/client to see what's returned
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("configs/client") || url.includes("user-info") || url.includes("current-user") || url.includes("auth")) {
      try {
        const body = await resp.text();
        console.log(`\n[RESP] ${url}\n  status: ${resp.status()}\n  body: ${body.slice(0, 500)}`);
      } catch {}
    }
  });

  // Also intercept fetch requests to log API responses
  await page.addInitScript(`
    (function() {
      const origFetch = window.fetch;
      window.fetch = function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        return origFetch.apply(this, args).then(resp => {
          if (url && (url.includes('configs/client') || url.includes('user') || url.includes('auth'))) {
            const clone = resp.clone();
            clone.text().then(body => {
              console.log('[FETCH]', url, body.slice(0, 500));
            }).catch(() => {});
          }
          return resp;
        });
      };
    })();
  `);

  console.log("Navigating...");
  try {
    await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
      waitUntil: "networkidle", timeout: 30000,
    });
  } catch (e) {
    console.log("goto error:", e.message);
  }

  await page.waitForTimeout(5000);

  // Check auth state
  const authState = await page.evaluate(() => {
    return {
      url: location.href,
      cookies: document.cookie.slice(0, 300),
      localStorageLength: localStorage.length,
      hash: location.hash,
    };
  });
  console.log("\n=== Auth State ===");
  console.log(JSON.stringify(authState, null, 2));

  // Check what's rendered
  const rendered = await page.evaluate(() => {
    const root = document.getElementById("root");
    const html = root?.innerHTML?.slice(0, 500) || "(no root)";
    return { rootHTML: html };
  });
  console.log("\n=== Root HTML ===");
  console.log(rendered.rootHTML);

  await browser.close();
}
main();
