import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  
  // Test 1: vanilla (no stealth)
  const ctx1 = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
  });
  await ctx1.addCookies([
    { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
    { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
    { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
  ]);
  const p1 = await ctx1.newPage();
  await p1.goto("https://app.apifox.com/main/teams/3883284?tab=project", { waitUntil: "domcontentloaded", timeout: 15000 });
  await p1.waitForTimeout(5000);
  const url1 = p1.url();
  const text1 = await p1.evaluate(() => document.body?.innerText?.includes("登录") ? "LOGIN" : "APP");
  console.log(`Test 1 (vanilla): URL=${url1.includes("login") ? "LOGIN" : "APP"}, content=${text1}`);
  await ctx1.close();

  // Test 2: stealth-only (no invasive tracing)
  const ctx2 = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx2.addCookies([
    { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
    { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
    { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
  ]);
  await ctx2.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: { id: 'abc' }, loadTimes: () => ({}), csi: () => ({}), app: {} };
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ brands: [{brand:'Google Chrome',version:'131'},{brand:'Chromium',version:'131'},{brand:'Not A;Brand',version:'24'}], mobile: false, platform: 'Windows' }) });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
  `);
  const p2 = await ctx2.newPage();
  await p2.goto("https://app.apifox.com/main/teams/3883284?tab=project", { waitUntil: "domcontentloaded", timeout: 15000 });
  await p2.waitForTimeout(5000);
  const url2 = p2.url();
  const bodyText2 = await p2.evaluate(() => document.body?.innerText?.slice(0, 500));
  const pageTitle2 = await p2.title();
  const isLoginPage2 = bodyText2.includes("登录") || bodyText2.includes("欢迎使用 Apifox");
  console.log(`Test 2 (stealth): URL=${url2.includes("login") ? "LOGIN" : "APP"}, loginPage=${isLoginPage2}, title=${pageTitle2}`);
  console.log(`  Body text: "${bodyText2.slice(0, 200)}"`);

  // Check if actual app content is there  
  const hasAppContent2 = await p2.evaluate(() => {
    const body = document.body?.innerText || '';
    return {
      hasProjects: body.includes('项目') || body.includes('project'),
      hasApi: body.includes('API') || body.includes('接口'),
      bodyLength: body.length,
    };
  });
  console.log(`  App content check: ${JSON.stringify(hasAppContent2)}`);
  await ctx2.close();

  await browser.close();
})();
