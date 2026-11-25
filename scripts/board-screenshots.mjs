// Screenshots of the board with three stories, light and dark, at 50% and 200% zoom.
// Writes PNGs to $OUT (default: ./board-screenshots). Run: SB=http://127.0.0.1:6160 node scripts/board-screenshots.mjs
import { mkdirSync } from 'node:fs';

import { SB, resetCanvas, launch, previewFrame, setView, waitForBoard } from './board-lib.mjs';

const OUT = process.env.OUT ?? 'board-screenshots';
mkdirSync(OUT, { recursive: true });
const views = {
  '50': { x: 40, y: 60, zoom: 0.5 },
  '200': { x: -40, y: 80, zoom: 2 },
};
for (const scheme of ['light', 'dark']) {
  for (const [name, view] of Object.entries(views)) {
    await resetCanvas();
const { browser, page } = await launch({ dpr: 2, colorScheme: scheme, width: 1440, height: 900 });
    await page.goto(`${SB}/`);
    await setView(page, 'board', view);
    await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
    await waitForBoard(page, 3);
    // Select the Header frame so its controls show.
    await previewFrame(page).locator('[data-colab-frame-title="frame_hdr"]').click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/board-${scheme}-${name}.png` });
    await browser.close();
  }
}
console.log('written to', OUT);
