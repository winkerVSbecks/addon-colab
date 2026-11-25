import { createRequire } from 'node:module';
const require = createRequire(new URL('./.tools/', import.meta.url));
const { chromium } = require('playwright-core');
const PW = `${process.env.HOME}/Library/Caches/ms-playwright`;
const targets = [
  ['Installed Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['Playwright chromium-1243', `${PW}/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`],
  ['Playwright chromium-1234', `${PW}/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`],
];
const flagSets = [[], ['--enable-blink-features=CanvasDrawElement'], ['--enable-experimental-web-platform-features']];
const url = new URL('./pages/detect.html', import.meta.url).href;
for (const [name, exe] of targets) {
  for (const flags of flagSets) {
    let browser;
    try {
      browser = await chromium.launch({ executablePath: exe, headless: process.env.HEADED ? false : true, args: flags });
      const page = await browser.newPage();
      await page.goto(url);
      const r = await page.evaluate(() => window.__detect);
      console.log(JSON.stringify({ name, version: browser.version(), flags, ...r, ua: undefined }));
    } catch (e) { console.log(JSON.stringify({ name, flags, error: String(e).slice(0, 200) })); }
    finally { await browser?.close(); }
  }
}
