import { createRequire } from 'node:module';
const require = createRequire(new URL('./.tools/', import.meta.url));
const { chromium } = require('playwright-core');
const SB = process.env.SB || 'http://localhost:6116';
const DPR = Number(process.env.DPR || 2);
const GEOM = process.env.GEOM || 'sized';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: !process.env.HEADED });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: DPR });
const out = { dpr: DPR, geom: GEOM };

// ---------- (b) several real stories inline in one preview document ----------
{
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${SB}/iframe.html?id=spike-board--default&viewMode=story&geom=${GEOM}`);
  await page.waitForFunction(() => window.spike);
  await page.evaluate(async () => {
    await window.spike.addStory('example-button--primary', 20, 20);
    await window.spike.addStory('example-header--logged-out', 20, 120);
    await window.spike.addStory('example-page--logged-out', 20, 230);
  });
  await page.waitForTimeout(800);
  const cases = [
    { name: 'zoom1', view: { zoom: 1, panX: 20, panY: 20 } },
    { name: 'zoom0.5-panned', view: { zoom: 0.5, panX: 300, panY: 60 } },
    { name: 'zoom1.75', view: { zoom: 1.75, panX: -10, panY: 10 } },
  ];
  out.b = {};
  for (const cs of cases) {
    await page.evaluate((v) => window.spike.setView(v), cs.view);
    await page.waitForTimeout(150);
    const res = {};
    for (const [label, sel, idx] of [['button', 'button', 0], ['headerLogin', 'header button', 1], ['pageH2', 'h2', 2]]) {
      const pt = await page.evaluate(([s, i]) => window.spike.modelPointOf(s, i), [sel, idx]);
      const corner = await page.evaluate(([s, i]) => window.spike.modelPointOf(s, i, 0.08), [sel, idx]);
      if (pt.x < 0 || pt.y < 0 || pt.x > 1100 || pt.y > 700) { res[label] = { skipped: 'off-canvas', pt }; continue; }
      const efp = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && `${e.tagName}${e.closest('[data-story-id]') ? '@' + e.closest('[data-story-id]').dataset.storyId : ''}:${(e.textContent || '').trim().slice(0, 20)}`; }, [pt.x, pt.y]);
      await page.mouse.move(pt.x, pt.y);
      await page.waitForTimeout(60);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(80);
      const last = await page.evaluate(() => window.spike.log.filter((l) => l[0] === 'click').at(-1));
      res[label] = { pt: [Math.round(pt.x), Math.round(pt.y)], pixelNearCorner: corner.pixel, elementFromPoint: efp, lastClick: last };
    }
    out.b[cs.name] = res;
    await page.screenshot({ path: `spike/out/board-${cs.name}-dpr${DPR}-${GEOM}.png` });
  }
  // Story state change repaints: clicking "Log in" inside Page story logs the user in.
  await page.evaluate(() => window.spike.setView({ zoom: 1, panX: 20, panY: 20 }));
  await page.waitForTimeout(100);
  const pageLogin = await page.evaluate(() => window.spike.modelPointOf('header button', 2));
  await page.mouse.click(pageLogin.x, pageLogin.y);
  await page.waitForTimeout(300);
  out.b.pageAfterLogin = await page.evaluate(() => window.spike.frames[2].el.querySelector('header').textContent.trim().slice(0, 60));
  out.b.defaultSize = await page.evaluate(() => [window.spike.defaultSize(0), window.spike.frames[0].el.offsetWidth, window.spike.frames[0].el.offsetHeight]);
  out.b.errors = await page.evaluate(() => window.spike.log.filter((l) => /error|exception/i.test(l[0])));
  out.b.stylesApplied = await page.evaluate(() => getComputedStyle(window.spike.frames[0].el.querySelector('button')).backgroundColor);
  await page.screenshot({ path: `spike/out/board-after-login-dpr${DPR}-${GEOM}.png` });
  await page.close();
  console.log(JSON.stringify({ b: out.b }, null, 1));
}

// ---------- (c) drag a sidebar story from the manager into the canvas in the preview iframe ----------
if (!process.env.SKIP_C) {
  const page = await ctx.newPage();
  await page.goto(`${SB}/?path=/story/spike-board--default&geom=${GEOM}`);
  const preview = page.frameLocator('#storybook-preview-iframe');
  await page.waitForSelector('#storybook-preview-iframe');
  // Expanding a component in the sidebar also navigates to its first story, so go back to the board afterwards.
  await page.locator('#example-button').click();
  await page.waitForTimeout(500);
  await page.locator('#spike-board--default').click();
  await page.waitForTimeout(500);
  const frame = page.frame({ url: /iframe\.html/ });
  await frame.waitForFunction(() => window.spike && document.querySelector('canvas'));
  const src = page.locator('[data-spike-drag="example-button--secondary"]');
  await src.waitFor();
  const sb = await src.boundingBox();
  const ifr = await page.locator('#storybook-preview-iframe').boundingBox();
  const target = { x: ifr.x + 400, y: ifr.y + 300 };
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(sb.x + (target.x - sb.x) * (i / 15), sb.y + (target.y - sb.y) * (i / 15));
  await page.mouse.up();
  await page.waitForTimeout(1000);
  out.c = {
    managerDragStarted: await page.evaluate(() => window.__spikeDragStarted ?? null),
    dropLog: await frame.evaluate(() => window.spike.log.filter((l) => l[0] === 'drop' || l[0] === 'dragover-types').slice(-2)),
    frames: await frame.evaluate(() => window.spike.frames.map((f) => [f.storyId, Math.round(f.x), Math.round(f.y)])),
    expectedWorld: await frame.evaluate(() => { const v = window.spike.view; const r = document.querySelector('canvas').getBoundingClientRect(); return [Math.round((400 - r.left - v.panX) / v.zoom), Math.round((300 - r.top - v.panY) / v.zoom)]; }),
  };
  await page.screenshot({ path: `spike/out/manager-drop-dpr${DPR}.png` });
  void preview;
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
