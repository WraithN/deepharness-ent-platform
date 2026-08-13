import { chromium } from "playwright";

const TOKEN = "zvtv41oRso6Q23joZth0xHM7ugfBRT9k";
const USER = {
  id: 3232299, name: "狐友UgzW",
  avatar: "https://cdn.apifox.com/app/avatar/builtin/19.png",
  username: "狐友UgzW", employeeNumber: null, email: null,
  hasPassword: false, bio: "", mobile: null,
  createdAt: "2025-10-14T02:34:22.000Z", deletedAt: null,
  features: {}, unreadCount: 0,
};

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });

  const userJSON = JSON.stringify(USER);

  await ctx.addInitScript(`
    var user = ${userJSON};
    var token = "${TOKEN}";
    localStorage.setItem("current_user", JSON.stringify(user));
    localStorage.setItem("currentUser", JSON.stringify(user));
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("authToken", token);
    localStorage.setItem("access_token", token);
    localStorage.setItem("token", token);
    sessionStorage.setItem("currentUser", JSON.stringify(user));
    console.log("[pre-boot] localStorage set, user keys:", 
      Object.keys(localStorage).filter(k => k.includes("user") || k.includes("auth") || k.includes("token")));
  `);

  const page = await ctx.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[pre-boot]") || t.includes("[page]")) console.log("[PAGE]", t.slice(0, 200));
  });

  console.log("[test] Navigating with pre-populated localStorage...");
  await page.goto("https://app.apifox.com/main/teams/3883284?tab=project", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  console.log("[test] URL after domcontentloaded:", page.url().slice(0, 120));

  await page.waitForTimeout(5000);
  console.log("[test] URL after 5s:", page.url().slice(0, 120));

  await page.waitForTimeout(5000);
  console.log("[test] URL after 10s:", page.url().slice(0, 120));

  // Deep inspect the page
  const info = await page.evaluate(() => {
    const dw = window as any;
    return {
      url: location.href,
      bodyText: document.body?.innerText?.slice(0, 500),
      rootHTML: (document.getElementById("root") as HTMLElement)?.innerHTML?.slice(0, 400),
      hasDva: !!dw.__dva_store__,
      lsKeys: Object.keys(localStorage).filter((k: string) =>
        k.includes("user") || k.includes("auth") || k.includes("token") || k.includes("current")
      ),
      // Check UMI model hook
      modelHook: (() => {
        const root = document.getElementById("root");
        if (!root) return null;
        const fiberKey = Object.keys(root).find(k => k.startsWith("__reactFiber"));
        if (!fiberKey) return null;
        const findModel = (fiber: any, depth = 0): any => {
          if (!fiber || depth > 30) return null;
          const hook = fiber.memoizedState;
          if (hook && hook.queue) {
            let h = hook;
            while (h) {
              const val = h.memoizedState;
              if (val && typeof val === "object" && "initialState" in val && "loading" in val) {
                return { depth, hasInit: !!val.initialState, loading: val.loading };
              }
              h = h.next;
            }
          }
          return findModel(fiber.child, depth + 1) || findModel(fiber.sibling, depth + 1);
        };
        return findModel(dw.__reactFiber || (root as any)[fiberKey]);
      })(),
    };
  });
  console.log("[test] Result:", JSON.stringify(info, null, 2));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
