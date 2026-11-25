import { createRequire } from 'node:module';
import { serve } from './server.mjs';
const require = createRequire(new URL('./.tools/', import.meta.url));
const { chromium } = require('playwright-core');
const { server, origin } = await serve();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: Number(process.env.DPR || 2) });
page.on('console', (m) => console.log('[console]', m.text()));
await page.goto(`${origin}/iframe.html?geom=${process.env.GEOM || 'auto'}`);
await page.evaluate(() => window.ready);
await page.waitForTimeout(300);
const out = {};
for (const zoom of [1, 1.5, 0.6]) {
  await page.evaluate((z) => window.setView({ zoom: z, panX: 40, panY: 30 }), zoom);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `spike/out/iframe-dpr${process.env.DPR || 2}-zoom${zoom}.png` });
  for (const [frameId, drawId] of [['ifrA', 'wrap'], ['ifrB', 'ifrB']]) {
    const info = await page.evaluate(([frameId, drawId]) => {
      const f = document.getElementById(frameId); const b = f.contentDocument.getElementById('btn');
      const br = b.getBoundingClientRect();
      const t = document.getElementById('c').getElementTransform(document.getElementById(drawId));
      const fr = f.getBoundingClientRect();
      const { panX, panY, zoom } = window.view; const [px, py] = window.place[drawId];
      // expected screen point = pan + zoom * (place + offset of button inside drawable element)
      // Model-based expected point: uses layout offsets only (independent of the geometry we set).
      const fOff = frameId === drawId ? [0, 0] : [f.offsetLeft + f.clientLeft, f.offsetTop + f.clientTop];
      const offX = fOff[0] + br.left + br.width / 2, offY = fOff[1] + br.top + br.height / 2;
      const ex = panX + zoom * (px + offX), ey = panY + zoom * (py + offY);
      const cv = document.getElementById('c'); const d = devicePixelRatio;
      const pixel = Array.from(cv.getContext('2d').getImageData(Math.round((panX + zoom * (px + fOff[0] + br.left + 6)) * d), Math.round((panY + zoom * (py + fOff[1] + br.top + 6)) * d), 1, 1).data);
      return { expected: [ex, ey], pixelAtExpected: pixel, frameRect: [fr.left, fr.top, fr.width, fr.height], transform: t.toString(), before: f.contentWindow.log.length, paintErrors: window.paintErrors };
    }, [frameId, drawId]);
    const hit = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? el.id || el.tagName : null; }, info.expected);
    await page.mouse.move(info.expected[0], info.expected[1]);
    await page.mouse.click(info.expected[0], info.expected[1]);
    await page.waitForTimeout(100);
    const after = await page.evaluate((id) => { const w = document.getElementById(id).contentWindow; return { log: w.log.slice(-2), count: w.document.getElementById('count').textContent }; }, frameId);
    out[`zoom${zoom}:${frameId}`] = { ...info, elementFromPoint: hit, after };
  }
}
// typing into the iframe input (focus via click)
await page.evaluate(() => window.setView({ zoom: 1 }));
await page.waitForTimeout(100);
const inpPt = await page.evaluate(() => { const f = document.getElementById('ifrA'); const r = f.contentDocument.getElementById('inp').getBoundingClientRect(); return [40 + 10 + f.offsetLeft + f.clientLeft + r.left + 10, 30 + 20 + f.offsetTop + f.clientTop + r.top + 5]; });
await page.mouse.click(...inpPt); await page.keyboard.type('hello');
await page.waitForTimeout(200);
out.typing = await page.evaluate(() => document.getElementById('ifrA').contentWindow.log.slice(-1));
out.paintsAfterTyping = await page.evaluate(() => window.paints);
await page.screenshot({ path: 'spike/out/iframe-typed.png' });
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
