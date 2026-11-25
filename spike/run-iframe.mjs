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
      const wrapR = document.getElementById(drawId).getBoundingClientRect();
      const offX = (fr.left - wrapR.left) + br.left + br.width / 2, offY = (fr.top - wrapR.top) + br.top + br.height / 2;
      return { expected: [panX + zoom * (px + offX), panY + zoom * (py + offY)], frameRect: [fr.left, fr.top, fr.width, fr.height], transform: t.toString(), before: f.contentWindow.log.length, paintErrors: window.paintErrors };
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
const inpPt = await page.evaluate(() => { const f = document.getElementById('ifrA'); const r = f.contentDocument.getElementById('inp').getBoundingClientRect(); const fr = f.getBoundingClientRect(); const w = document.getElementById('wrap').getBoundingClientRect(); return [40 + 10 + (fr.left - w.left) + r.left + 10, 30 + 20 + (fr.top - w.top) + r.top + 5]; });
await page.mouse.click(...inpPt); await page.keyboard.type('hello');
await page.waitForTimeout(200);
out.typing = await page.evaluate(() => document.getElementById('ifrA').contentWindow.log.slice(-1));
out.paintsAfterTyping = await page.evaluate(() => window.paints);
await page.screenshot({ path: 'spike/out/iframe-typed.png' });
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
