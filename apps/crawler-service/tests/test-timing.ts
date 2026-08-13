import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    colorScheme: "light",
    reducedMotion: "no-preference",
    bypassCSP: true,
  });
  await ctx.addCookies([
    { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
    { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
    { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
  ]);
  
  // Block login page at network level  
  await ctx.route("**/user/login**", (route) => route.abort());
  
  const page = await ctx.newPage();
  
  let redirectHappened = false;
  page.on("framenavigated", (f) => {
    if (f.url().includes("/user/login")) {
      redirectHappened = true;
      console.log("  [!!!] REDIRECT TO LOGIN DETECTED");
    }
  });

  // Try with "load" first - get content ASAP  
  console.log("Navigating (waitUntil: load)...");
  try {
    await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
      waitUntil: "load",
      timeout: 15000,
    });
    console.log("After load - URL:", page.url());
    console.log("Redirect happened:", redirectHappened);
  } catch (e: any) {
    console.log("Goto error:", e.message);
    console.log("Current URL:", page.url());
  }

  // Wait for React to render
  await page.waitForTimeout(5000);
  console.log("After 5s URL:", page.url());
  
  if (!redirectHappened && page.url().includes("main/teams")) {
    console.log("\nSUCCESS! On app page. Extracting content...");
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
    console.log("Content:", text);
    
    // Check if React rendered something meaningful
    const hasRoot = await page.evaluate(() => {
      const root = document.getElementById("root");
      if (!root) return "no #root";
      return `#root has ${root.children.length} children, innerHTML length: ${root.innerHTML.length}`;
    });
    console.log("Root:", hasRoot);
  } else {
    console.log("\nStill redirected.");
  }

  await browser.close();
})();
