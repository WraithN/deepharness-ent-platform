/**
 * Full login flow - fix crash by adding all missing fields + user-data endpoint.
 */
import { chromium } from "playwright";

const TARGET = "https://app.apifox.com/main/teams/3883284?tab=project";

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    locale: "zh-CN", viewport: { width: 1920, height: 1080 },
  });
  const page = await ctx.newPage();

  page.on("pageerror", (err) => log(`PAGE ERROR: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") log(`CONSOLE: ${msg.text().slice(0, 400)}`);
  });

  await page.route("http://121.199.72.199/**", async (route) => route.abort());

  // ===== SINGLE CATCH-ALL =====
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Log all intercepted API calls
    const path = url.replace("https://api.apifox.com", "");
    log(`[API] ${method} ${path.slice(0, 120)}`);

    // Login
    if (url.includes("/api/v1/login") && method === "POST") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          success: true, code: 0,
          data: {
            accessToken: "FAKE_TOKEN_XXX",
            refreshToken: "FAKE_REFRESH_XXX",
            user: {
              id: 3232299,
              username: "testuser",
              name: "Test User",
              email: "test@apifox.com",
              phone: "13800138000",
              avatar: "https://cdn.apifox.com/avatar/default.png",
              role: "owner",
              status: "active",
              lang: "zh-CN",
              timezone: "Asia/Shanghai",
            },
          },
        }),
      });
    }

    // User-data (new endpoint discovered)
    if (url.includes("/api/v1/user-data")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          success: true, code: 0,
          data: {
            userId: 3232299,
            currentTeamId: 3883284,
            currentProjectId: 3883284,
            recentlyViewedProjects: [{ id: 3883284, name: "Test Project", teamId: 3883284, teamName: "Test Team" }],
            starredApis: [],
            favorites: [],
          },
        }),
      });
    }

    // User teams — MUST have "plan" field (used for payment badge in team selector)
    if (url.includes("/api/v1/user-teams")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          success: true, code: 0,
          data: [{
            id: 3883284,
            name: "Test Team",
            slug: "test-team",
            description: "A test team",
            logo: "https://cdn.apifox.com/team-logo/default.png",
            role: "owner",
            roleName: "Owner",
            memberCount: 1,
            projectCount: 1,
            ownerId: 3232299,
            ownerName: "Test User",
            plan: "free",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            isDefault: true,
            permissions: ["manage", "edit", "view"],
          }],
        }),
      });
    }

    // User organizations
    if (url.includes("/api/v1/user/organizations")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: [] }),
      });
    }

    // Experiment variants
    if (url.includes("/api/v1/user-experiment")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: {} }),
      });
    }

    // Payment plans — must have "plan" field (not just "type")
    if (url.includes("/api/v1/payment")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          success: true, code: 0,
          data: {
            currentPlan: { type: "free", name: "Free", plan: "free" },
            availablePlans: [
              { type: "free", name: "Free", plan: "free" },
              { type: "pro", name: "Pro", plan: "pro" },
              { type: "enterprise", name: "Enterprise", plan: "enterprise" },
            ],
          },
        }),
      });
    }

    // Main user endpoint
    if (url.includes("/api/v1/user") && !url.includes("user-teams") && !url.includes("user-experiment") && !url.includes("user/organizations") && !url.includes("user-data") && !url.includes("user-projects") && !url.includes("current-user")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          success: true, code: 0,
          data: {
            id: 3232299,
            username: "testuser",
            name: "Test User",
            email: "test@apifox.com",
            phone: "13800138000",
            avatar: "https://cdn.apifox.com/avatar/default.png",
            role: "owner",
            status: "active",
            lang: "zh-CN",
            timezone: "Asia/Shanghai",
            notificationSettings: { email: true, browser: true },
            theme: "light",
          },
        }),
      });
    }

    // Notices — mock to prevent 401 -> redirect to login
    if (url.includes("/api/v1/notices")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: { list: [], total: 0 } }),
      });
    }

    // Teams details & related endpoints
    if (url.includes("/api/v1/teams/") && url.includes("/projects")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          success: true, code: 0,
          data: [
            { id: 1, name: "Demo Project", description: "A demo project", type: "http", visibility: "private", members: 1, apis: 10, updatedAt: "2024-01-01T00:00:00.000Z" },
          ],
        }),
      });
    }

    if (url.includes("/api/v1/teams/")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          success: true, code: 0,
          data: url.includes("/subscription") ? { plan: "free", status: "active" }
            : url.includes("/usage") ? { apiCalls: { used: 0, total: 1000 }, storage: { used: 0, total: 1024 } }
            : { id: 3883284, name: "Test Team", plan: "free", slug: "test-team" },
        }),
      });
    }

    // User projects — must be {success, data: []} format
    if (url.includes("/api/v1/user-projects")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: [] }),
      });
    }

    // Git connections - reducer expects data to be an array (does .forEach)
    if (url.includes("/api/v1/current-user/git")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ success: true, code: 0, data: [] }),
      });
    }

    // Pass through everything else
    return route.continue();
  });

  // ===== NAVIGATE =====
  await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);

  const switchBtn = page.locator('button:has-text("邮箱登录"), a:has-text("邮箱登录")');
  if (await switchBtn.count() > 0) {
    await switchBtn.first().click();
    await page.waitForTimeout(500);
  }

  await page.fill("#account", "testuser@apifox.com");
  await page.fill("#password", "FakePassword123");
  await page.locator('button[type="submit"]:has-text("登 录")').click();
  log("Login submitted");

  await page.waitForTimeout(8000);
  log(`After login URL: ${page.url()}`);

  // Click "Test Team" in sidebar to navigate to the team page
  // (The app uses currentTeamId for routing, not the URL path directly)
  if (!page.url().includes("/teams/3883284")) {
    log("Clicking Test Team in sidebar...");
    const teamLink = page.locator('text=Test Team').first();
    if (await teamLink.count() > 0) {
      await teamLink.click();
      await page.waitForTimeout(3000);
    } else {
      log("Test Team link not found, navigating directly...");
      await page.goto(TARGET, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(3000);
    }
  }

  // Click "团队项目" tab to ensure project tab is active
  const projectTab = page.locator('text=团队项目').first();
  if (await projectTab.count() > 0) {
    await projectTab.click();
    await page.waitForTimeout(2000);
  }

  log(`\n=== RESULT ===`);
  log(`URL: ${page.url()}`);
  log(`Title: ${await page.title()}`);

  const body = await page.evaluate("document.body ? document.body.innerText.slice(0, 5000) : 'no body'");
  log(`Body:\n${body || "(empty)"}`);

  // Extract content structure for analysis
  const contentStructure = await page.evaluate("(() => { const els = document.querySelectorAll('[class*=project], [class*=card], [class*=list]'); return Array.from(els).slice(0, 15).map(e => ({ tag: e.tagName, class: e.className?.toString().slice(0, 80), text: e.textContent?.trim().slice(0, 80) })); })()");
  log(`\nContent structure:\n${JSON.stringify(contentStructure, null, 2)}`);

  await page.screenshot({ path: "/tmp/apifox-dashboard-v4.png", fullPage: true });
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
