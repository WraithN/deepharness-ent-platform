const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/sbin/chromium' });
  const page = await browser.newPage();
  
  const wsMessages = [];
  const consoleLogs = [];
  
  page.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#username', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  
  // 输入消息并发送
  await page.fill('textarea', '帮我写一个登录组件');
  await page.keyboard.press('Enter');
  
  // 等待后端响应（agent-mock 需要一些时间）
  await page.waitForTimeout(8000);
  
  const text = await page.evaluate(() => document.body.innerText);
  console.log('=== BODY TEXT (chat area) ===');
  console.log(text.substring(0, 1200));
  
  console.log('\n=== CONSOLE LOGS ===');
  consoleLogs.forEach(l => console.log(l));
  
  await browser.close();
})();
