import { chromium } from "playwright";

const INIT_SCRIPT = `
(function() {
  const TRUE = () => true;
  const ZERO = () => 0;

  // navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // window.chrome  
  window.chrome = {
    runtime: { id: 'cpmheoeobamkdpnoeebmjonebmgobkgh' },
    loadTimes: () => ({}),
    csi: () => ({}),
    app: {},
  };

  // navigator.userAgentData with realistic brands
  const brandVersions = [
    { brand: 'Google Chrome', version: '131' },
    { brand: 'Not(A:Brand', version: '24' },
    { brand: 'Chromium', version: '131' },
  ];
  Object.defineProperty(navigator, 'userAgentData', {
    get: () => ({
      brands: brandVersions,
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: async (hints) => {
        const result = {};
        for (const h of hints) {
          if (h === 'platform') result.platform = 'Windows';
          else if (h === 'platformVersion') result.platformVersion = '10.0.0';
          else if (h === 'architecture') result.architecture = 'x86';
          else if (h === 'model') result.model = '';
          else if (h === 'fullVersionList') result.fullVersionList = brandVersions;
        }
        return result;
      },
    }),
  });

  // navigator.hardwareConcurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

  // navigator.deviceMemory
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

  // screen.colorDepth
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

  // navigator.permissions.query - properly mock
  const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
  window.navigator.permissions.query = (parameters) => {
    if (parameters.name === 'notifications') return Promise.resolve({ state: Notification.permission });
    return origQuery(parameters);
  };

  // Intercept location changes to detect the redirect source
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function(s, t, url) {
    console.log('[TRACE] history.pushState:', url);
    origPush(s, t, url);
  };
  history.replaceState = function(s, t, url) {
    console.log('[TRACE] history.replaceState:', url);
    origReplace(s, t, url);
  };
  
  // Trace location.href changes
  const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
  Object.defineProperty(document, 'location', {
    get: function() { return window.location.href; },
    set: function(v) {
      console.log('[TRACE] document.location set to:', v);
      hrefDesc.set.call(window.location, v);
    }
  });

  // Trace fetch calls
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
    console.log('[TRACE] fetch GET/POST?', args[1]?.method || 'GET', url.slice(0, 100));
    return origFetch.apply(this, args);
  };

  // Trace XHR
  const OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new OrigXHR();
    const origOpen = xhr.open;
    xhr.open = function(method, url, ...rest) {
      console.log('[TRACE] XHR', method, String(url).slice(0, 100));
      return origOpen.apply(this, [method, url, ...rest]);
    };
    return xhr;
  };
  window.XMLHttpRequest.prototype = OrigXHR.prototype;

  // Trace cookie reads
  const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  Object.defineProperty(Document.prototype, 'cookie', {
    get: function() {
      const val = cookieDesc.get.call(this);
      console.log('[TRACE] document.cookie read, length:', val.length);
      return val;
    },
    set: function(v) {
      console.log('[TRACE] document.cookie set:', v.slice(0, 100));
      cookieDesc.set.call(this, v);
    }
  });

  console.log('[INIT] Stealth tracing installed');
})();
`;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  await ctx.addCookies([
    { name: "Authorization", value: "Bearer zvtv41oRso6Q23joZth0xHM7ugfBRT9k", domain: ".apifox.com", path: "/" },
    { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
    { name: "projectCid", value: "lUJfAZQR-jb6t-OT66-lnBy-MtBwBm1xxkCL", domain: ".apifox.com", path: "/" },
  ]);

  await ctx.route("**/user/login**", (route) => {
    console.log("  [ROUTE] Blocked navigation to login!");
    route.abort();
  });
  
  await ctx.addInitScript(INIT_SCRIPT);

  const page = await ctx.newPage();

  // Collect all [TRACE] console logs
  const traces: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().startsWith("[TRACE]") || msg.text().startsWith("[INIT]")) {
      traces.push(msg.text());
      console.log("  " + msg.text());
    }
    if (msg.type() === "error") {
      console.log("  [ERROR]", msg.text().slice(0, 300));
    }
  });

  page.on("framenavigated", (f) => {
    console.log("  [NAV]", f.url());
  });

  const onTarget = "https://app.apifox.com/main/teams/3883284?tab=project";
  console.log("Navigating to", onTarget);

  try {
    await page.goto(onTarget, { waitUntil: "domcontentloaded", timeout: 15000 });
    console.log("domcontentloaded: URL =", page.url());

    for (const sec of [2, 5, 10]) {
      await page.waitForTimeout(sec * 1000 - (sec === 2 ? 0 : 0));
      const pageContent = await page.evaluate((s) => {
        const root = document.getElementById("root");
        if (!root) return { type: "no-root", sec: s };
        const bodyText = document.body?.innerText?.slice(0, 300);
        const hasLoginForm = !!document.querySelector('input[type="password"]') || 
                             !!document.querySelector('.login') ||
                             (document.body?.innerText?.includes('登录') && document.body?.innerText?.includes('密码'));
        return { 
          type: "root-exists",
          sec: s,
          rootChildren: root.children.length,
          bodyText: bodyText,
          hasLoginForm,
        };
      }, sec);
      console.log(`  [${sec}s] URL: ${page.url()} | rootChildren: ${pageContent.rootChildren} | hasLogin: ${pageContent.hasLoginForm} | bodyText: "${pageContent.bodyText?.slice(0, 100)}"`);
    };

  } catch (e) {
    console.log("Error:", e instanceof Error ? e.message : String(e));
  }

  await browser.close();
})();
