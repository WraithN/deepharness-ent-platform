/**
 * Test 1: Can we dynamically register @@initialState reducer?
 * Test 2: Does setting token BEFORE load allow natural auth?
 */
import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const COOKIES = [
  { name: "Authorization", value: `Bearer ${TOKEN}`, domain: ".apifox.com", path: "/" },
  { name: "Authorization.sig", value: "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA", domain: ".apifox.com", path: "/" },
];
const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent: UA, locale: "zh-CN", viewport: { width: 1920, height: 1080 } });
  await ctx.addCookies(COOKIES);

  // Set localStorage BEFORE page load
  await ctx.addInitScript(`
    localStorage.setItem("Context:accessToken", "${TOKEN}");
    localStorage.setItem("Context:accessToken.sig", "kbRNeHN8HVbc-j8tQ2WJiZ-JaeRQSrHAwlE2cH8lYJA");
    // Also try Apifox-specific keys used in the app
    localStorage.setItem("apifox_login_token", JSON.stringify({ access_token: "${TOKEN}" }));
    console.log("[init] localStorage token set");
  `);

  // DON'T block redirects — let auth happen naturally
  // DON'T block any history/location methods

  const page = await ctx.newPage();
  
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push("CONSOLE: " + msg.text().slice(0, 200)); });

  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 60000 });
  
  // Wait to see what happens
  await page.waitForTimeout(8000);
  
  const result = await page.evaluate(() => {
    const root = document.getElementById("root");
    const w = window as any;
    const store = w.__dva_store__;
    
    if (!store) return { error: "No store found", url: location.href, bodyText: document.body?.innerText?.slice(0, 500) };
    
    const state = store.getState();
    const userState = state.user;
    const loginState = state.login;
    const initialStateExists = typeof state["@@initialState"] !== "undefined";
    
    return {
      url: location.href,
      rootChildren: root?.children.length ?? 0,
      rootInnerHTML: root?.innerHTML?.slice(0, 500) ?? "no root",
      bodyText: document.body?.innerText?.slice(0, 500) || "(empty)",
      userState: userState ? { 
        currentUserId: userState.currentUser?.id,
        currentUserName: userState.currentUser?.name 
      } : "no user model",
      loginState: loginState ? { success: loginState.success } : "no login model",
      initialStateExists,
      modelKeys: Object.keys(state).filter(k => k.startsWith('@@')),
      loadingState: state.loading ? { global: state.loading.global, effects: Object.keys(state.loading.effects || {}) } : "no loading",
    };
  });
  
  console.log(JSON.stringify(result, null, 2));
  console.log("\nErrors:", errors.length > 0 ? errors : "none");
  await page.screenshot({ path: "/tmp/apifox-natural-auth.png" });
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
