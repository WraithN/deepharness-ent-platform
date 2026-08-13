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

  // Set ALL possible localStorage keys
  await page.addInitScript((token) => {
    const encoded = JSON.stringify({ id: 3232299, name: "狐友UgzW", username: "狐友UgzW" });
    localStorage.setItem("userToken", token);
    localStorage.setItem("currentAccessToken", token);
    localStorage.setItem("user", encoded);
    localStorage.setItem("currentUser", encoded);
    localStorage.setItem("af_user", encoded);
  }, TOKEN);

  // INTERCEPT ALL XHR/fetch to log headers
  await page.addInitScript(`
    (function() {
      const origFetch = window.fetch;
      window.fetch = function(...args) {
        const req = args[0];
        const url = typeof req === "string" ? req : req.url;
        if (url.includes("api.apifox.com/api/")) {
          console.log("[FETCH] " + url.replace("https://api.apifox.com", "").slice(0, 150));
          if (args[1]?.headers) {
            try {
              const h = args[1].headers;
              if (h instanceof Headers) {
                for (const [k, v] of h.entries()) {
                  if (k.toLowerCase().includes("auth") || k.toLowerCase().includes("token")) {
                    console.log("[FETCH-HEADER] " + k + ": " + v.slice(0, 100));
                  }
                }
              }
            } catch(e) {}
          }
        }
        return origFetch.apply(this, args);
      };

      // Override XMLHttpRequest
      const OrigXHR = window.XMLHttpRequest;
      window.XMLHttpRequest = class extends OrigXHR {
        open(method, url) {
          this._url = url;
          super.open(method, url);
        }
        setRequestHeader(name, value) {
          if (this._url && this._url.includes("api.apifox.com/api/")) {
            if (name.toLowerCase().includes("auth") || name.toLowerCase().includes("token")) {
              console.log("[XHR-HEADER] " + name + ": " + value.slice(0, 100));
            }
          }
          return super.setRequestHeader(name, value);
        }
      };
    })();
  `);

  console.log("Loading page, watching ALL request headers...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  console.log("\n=== Done ===");
  console.log(`URL: ${page.url()}`);
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 200));
  console.log(`Body: "${body}"`);

  await browser.close();
}
main();
