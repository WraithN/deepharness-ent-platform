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

  // Set localStorage tokens
  await page.addInitScript((token) => {
    localStorage.setItem("userToken", token);
    localStorage.setItem("currentAccessToken", token);
    localStorage.setItem("user", JSON.stringify({ id: 3232299, name: "狐友UgzW", username: "狐友UgzW" }));
  }, TOKEN);

  // Intercept the main HTML page to see its content
  const htmlResponses: string[] = [];
  page.on("response", (resp) => {
    if (resp.url() === "https://app.apifox.com/main/teams/3883284" ||
        resp.url().startsWith("https://app.apifox.com/main/teams/3883284?")) {
      resp.text().then(t => {
        htmlResponses.push(t);
      });
    }
  });

  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "networkidle", timeout: 60000,
  });

  for (const html of htmlResponses) {
    console.log(`=== Main page HTML (${html.length} bytes) ===`);
    // Search for initial state/data
    const stateMatch = html.match(/window\.(?:__INITIAL_STATE__|__DATA__|__initialState|g_initialProps|__UMI_DATA__)["\s=:]+/g);
    const scriptTags = html.match(/<script[^>]*>[^<]*user[^<]*<\/script>/gi);
    const inlineScripts = html.match(/<script[^>]*>[\s\S]{50,500}<\/script>/gi);

    console.log("State matches:", stateMatch?.join(", "));
    console.log("User-related scripts:", scriptTags?.slice(0, 3)?.join("\n  "));
    console.log("\nInline scripts (up to 500 chars each):");
    if (inlineScripts) {
      inlineScripts.slice(0, 5).forEach((s, i) => {
        console.log(`  [${i}] ${s.slice(0, 400)}`);
      });
    }

    // Check for window.__ prefix variables
    const windowVars = html.match(/window\.\w+/g);
    if (windowVars) {
      const unique = [...new Set(windowVars)].slice(0, 30);
      console.log("\nwindow.* variables:", unique.join(", "));
    }
  }

  const url = page.url();
  console.log(`\nURL: ${url}`);

  // Check if window has any global state
  const globalState = await page.evaluate(() => {
    const win = window as any;
    const keys = Object.keys(win).filter(k => k.startsWith("__") || k.includes("initial") || k.includes("state") || k.includes("umi"));
    return keys.slice(0, 20);
  });
  console.log(`Global state keys: ${globalState.join(", ")}`);

  await browser.close();
}
main();
