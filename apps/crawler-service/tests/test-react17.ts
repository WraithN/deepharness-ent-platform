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

  // Intercept critical API responses
  const criticalResponses: Record<string, any> = {};
  page.on("response", async (resp) => {
    const url = resp.url();
    try {
      if (url.includes("/configs/client")) {
        const body = await resp.text();
        criticalResponses["configs/client"] = body.slice(0, 2000);
      }
      if (url.includes("/configs/url")) {
        const body = await resp.text();
        criticalResponses["configs/url"] = body.slice(0, 2000);
      }
    } catch {}
  });

  // Block redirect to login so React can hydrate
  await page.addInitScript(`
    (function() {
      const orig = history.replaceState;
      history.replaceState = function() {
        if (arguments[2] && typeof arguments[2] === "string" && arguments[2].includes("/user/login")) return;
        return orig.apply(history, arguments);
      };
      const origPush = history.pushState;
      history.pushState = function() {
        if (arguments[2] && typeof arguments[2] === "string" && arguments[2].includes("/user/login")) return;
        return origPush.apply(history, arguments);
      };
    })();
  `);

  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  console.log(`\n=== Critical API responses ===`);
  for (const [k, v] of Object.entries(criticalResponses)) {
    console.log(`\n--- ${k} ---`);
    console.log(v);
  }

  // React 17 internal check
  const react17 = await page.evaluate(() => {
    const root = document.getElementById("root");
    if (!root) return { error: "no root" };

    // React 17 keys on root element
    const reactKeys = Object.keys(root).filter(k =>
      k.startsWith("_reactRootContainer") || k.includes("__react") || k.startsWith("__reactContainer") || k.startsWith("__reactFiber") || k.startsWith("__reactInternal")
    );

    // Check if ReactDOM.render or hydrate was called
    const globalWindow = window as any;
    const hasRenderCalled = !!globalWindow.ReactDOM?._roots;

    return {
      reactKeys,
      hasRenderCalled,
      rootHTML: root.innerHTML.slice(0, 500),
      rootChildTag: root.children[0]?.tagName,
      rootChildClass: root.children[0]?.className?.toString()?.slice(0, 200),
    };
  });

  console.log(`\n=== React 17 internal state ===`);
  console.log(JSON.stringify(react17, null, 2));

  const url = page.url();
  console.log(`\nFinal URL: ${url}`);

  await browser.close();
}
main();
