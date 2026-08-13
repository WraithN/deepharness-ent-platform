import { chromium } from "playwright";

const COOKIES = [
  { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
  { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
];

async function checkDetectVectors() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  // Check 1: load with JS disabled to confirm server HTML is fine
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  // Check CDP-specific signals
  const signals = await page.evaluate(() => {
    const results: Record<string, any> = {};

    // CDP detection
    results.webdriver = (navigator as any).webdriver;
    results.chromeRuntime = !!(window as any).chrome?.runtime;
    results.chromeRuntimeId = (window as any).chrome?.runtime?.id;
    results.permissions = typeof navigator.permissions?.query === "function";

    // Common headless signals
    results.pluginsLen = navigator.plugins.length;
    results.mimeTypesLen = navigator.mimeTypes.length;
    try { results.hairline = CSS.supports("(-webkit-hyphens:none)") ? "supported" : "not supported"; } catch { results.hairline = "error"; }
    results.hardwareConcurrency = navigator.hardwareConcurrency;
    results.deviceMemory = (navigator as any).deviceMemory;
    results.platform = navigator.platform;
    results.userAgentData = !!(navigator as any).userAgentData;
    results.productSub = navigator.productSub;

    // Screen/Window properties
    results.colorDepth = screen.colorDepth;
    results.pixelDepth = screen.pixelDepth;
    results.outerWidth = window.outerWidth;
    results.outerHeight = window.outerHeight;
    results.innerWidth = window.innerWidth;
    results.innerHeight = window.innerHeight;
    results.screenWidth = screen.width;
    results.screenHeight = screen.height;
    results.screenAvailWidth = screen.availWidth;
    results.screenAvailHeight = screen.availHeight;

    // Canvas fingerprint (headless renders differently)
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 16; canvas.height = 16;
      const ctx = canvas.getContext("2d");
      if (ctx) { ctx.fillStyle = "rgb(255,0,0)"; ctx.fillRect(0,0,8,8); ctx.font = "10px Arial"; ctx.fillStyle = "rgb(0,255,0)"; ctx.fillText("A",0,10); }
      results.canvasHash = canvas.toDataURL().length; // Different for real vs headless browsers
    } catch { results.canvasHash = "error"; }

    // WebGL fingerprint
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (gl) {
        const debugInfo = (gl as any).getExtension("WEBGL_debug_renderer_info");
        results.webglVendor = debugInfo ? (gl as any).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : "no extension";
        results.webglRenderer = debugInfo ? (gl as any).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "no extension";
      } else { results.webgl = "not supported"; }
    } catch { results.webgl = "error"; }

    // Fonts detection (headless might lack system fonts)
    try {
      const available = !!(document as any).fonts?.check("12px Arial");
      results.fontCheck = available ? "yes" : "no";
    } catch { results.fontCheck = "error"; }

    // Touch support
    results.maxTouchPoints = navigator.maxTouchPoints;
    results.ontouchstartInWindow = "ontouchstart" in window;

    // Performance timing
    results.performanceMemory = !!(performance as any).memory;
    if ((performance as any).memory) {
      results.jsHeapSizeLimit = (performance as any).memory.jsHeapSizeLimit;
      results.totalJSHeapSize = (performance as any).memory.totalJSHeapSize;
    }

    // Notification permissions
    results.notificationPerm = Notification?.permission;

    return results;
  });

  console.log("=== Headless browser fingerprint signals ===");
  for (const [key, val] of Object.entries(signals)) {
    console.log(`  ${key}: ${JSON.stringify(val)}`);
  }

  await browser.close();
}

checkDetectVectors();
