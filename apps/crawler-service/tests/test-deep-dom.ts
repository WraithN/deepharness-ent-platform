import { chromium } from "playwright";
import path from "path";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

const FAKE_SEC_CH_UA = "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not=A?Brand\";v=\"24\"";

const USER_DATA = {
  id: 3232299, name: "狐友UgzW", username: "狐友UgzW",
  email: null, hasPassword: false, features: {},
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies(COOKIES);

  const page = await ctx.newPage();

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

  await page.addInitScript((userData) => {
    const encoded = JSON.stringify(userData);
    localStorage.setItem("user", encoded);
    localStorage.setItem("currentUser", encoded);
    localStorage.setItem("userInfo", encoded);
    localStorage.setItem("af_user", encoded);
  }, USER_DATA);

  await page.addInitScript(`
    (function() {
      const origReplace = history.replaceState;
      history.replaceState = function() {
        const url = arguments[2];
        if (typeof url === "string" && url.includes("/user/login")) return;
        return origReplace.apply(history, arguments);
      };
    })();
  `);

  // Listen for console messages from page
  page.on("console", (msg) => {
    if (msg.type() === "log" || msg.type() === "error") {
      console.log(`  [page ${msg.type()}] ${msg.text().slice(0, 200)}`);
    }
  });

  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  await page.waitForTimeout(15000);

  // Detailed DOM analysis
  const domInfo = await page.evaluate(() => {
    const root = document.getElementById("root");
    if (!root) return { error: "no root" };

    // Check for ALL divs with classes (first 2 levels deep)
    const topDivs = Array.from(root.querySelectorAll(":scope > div:first-child > *"));
    const topInfo = topDivs.map(d => ({
      tag: d.tagName,
      className: d.className?.toString()?.slice(0, 120),
      childCount: d.children?.length,
      computed: d.computedStyleMap ? "available" : "no",
      style: d.getAttribute("style")?.slice(0, 100),
    }));

    // Check for hidden/modal layers
    const modals = Array.from(document.querySelectorAll("[class*=\"modal\"], [class*=\"Modal\"], [class*=\"overlay\"], [class*=\"Overlay\"]"));
    const modalInfo = modals.map(m => ({
      tag: m.tagName,
      class: m.className?.toString()?.slice(0, 100),
      text: m.innerText?.slice(0, 50),
      rect: m.getBoundingClientRect ? JSON.stringify(m.getBoundingClientRect()) : "no rect",
    }));

    // Check what's REACT in there
    const rootChildren = root.children;
    const rootHtml = root.outerHTML.slice(0, 3000);

    // Count all React fiber nodes
    const fiberCount = (root.outerHTML.match(/react-/g) || []).length;

    return { topInfo, modalInfo: modalInfo.slice(0, 3), rootChildren: rootChildren.length, fiberCount, rootHtml: rootHtml.slice(0, 2000) };
  });

  const screenshotPath = path.resolve("/tmp/apifox-deep.jpg");
  await page.screenshot({ path: screenshotPath, fullPage: false, quality: 80 });

  console.log(`\n=== Deep DOM ===`);
  console.log(`Root children: ${domInfo.rootChildren}`);
  console.log(`React fiber count: ${domInfo.fiberCount}`);
  console.log(`Top divs:`, JSON.stringify(domInfo.topInfo?.slice(0, 5), null, 2));
  console.log(`Modals:`, JSON.stringify(domInfo.modalInfo, null, 2));
  console.log(`Root HTML (2k): ${domInfo.rootHtml?.slice(0, 200)}...`);

  const url = page.url();
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200));
  console.log(`\nURL: ${url}`);
  console.log(`Body text: "${bodyText}"`);

  await browser.close();
}
main();
