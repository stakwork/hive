import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // Go to sign-in page
    console.log('Navigating to sign-in page...');
    await page.goto('http://localhost:3000/auth/signin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Click mock sign-in button
    console.log('Clicking mock sign-in button...');
    await page.click('[data-testid="mock-signin-button"]');
    await page.waitForTimeout(5000);

    console.log('Current URL after signin:', page.url());

    // Navigate to learn page
    console.log('Navigating to learn page...');
    await page.goto('http://localhost:3000/w/dev-user-workspace/learn', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    await page.waitForTimeout(5000);

    console.log('Current URL at learn page:', page.url());

    // Take screenshot
    const screenshotDir = path.join(os.homedir(), '.agent-browser/tmp/screenshots');
    const screenshotPath = path.join(screenshotDir, 'learn-viewer-ui.png');
    console.log('Taking screenshot...');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to: ${screenshotPath}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await browser.close();
  }
})();
