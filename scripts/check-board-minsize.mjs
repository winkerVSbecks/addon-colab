// A frame narrower than the minimum in the file is shown at the minimum width; undoing
// its removal puts back the file's own size; at low zoom a selected small frame's title
// keeps a usable width.
// Rewrites $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6170 CANVAS_DIR=<its canvas dir> node scripts/check-board-minsize.mjs
import { readFileSync, writeFileSync } from 'node:fs';

import { BASE_CANVAS, CANVAS_FILE, SB, boardState, check, done, launch, previewFrame, setView, waitForBoard } from './board-lib.mjs';

const thin = { id: 'frame_thin', storyId: 'example-button--secondary', x: 0, y: 160, width: 1 };
writeFileSync(CANVAS_FILE, JSON.stringify({ ...BASE_CANVAS, frames: [BASE_CANVAS.frames[0], thin] }, null, 2) + '\n');
await new Promise((resolve) => setTimeout(resolve, 600));

const { browser, page, errors } = await launch({ dpr: 2 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 2);
const preview = previewFrame(page);

const width = await preview.locator('[data-colab-frame="frame_thin"]').evaluate((e) => e.offsetWidth);
const state = await boardState(page);
check('a 1px-wide frame from the file is drawn 120px wide', width === 120, width);
check('… and its title and handles use the same width', state.frames.find((f) => f.id === 'frame_thin').width === 120);
const chrome = await preview.locator('[data-colab-chrome="frame_thin"]').boundingBox();
check('… on screen too', Math.round(chrome.width) === 120, chrome);
await page.waitForTimeout(1800);
const file = JSON.parse(readFileSync(CANVAS_FILE, 'utf8')).frames.find((f) => f.id === 'frame_thin');
check('the file keeps its width until the frame is resized', file.width === 1, file);

const before = JSON.parse(readFileSync(CANVAS_FILE, 'utf8')).frames.find((f) => f.id === 'frame_thin');
await preview.locator('[data-colab-frame-title="frame_thin"]').focus();
await page.keyboard.press('Delete');
await page.waitForTimeout(800);
const removed = JSON.parse(readFileSync(CANVAS_FILE, 'utf8')).frames.some((f) => f.id === 'frame_thin');
check('Delete on the title removes the thin frame', !removed);
await page.keyboard.press('Meta+z');
await page.waitForTimeout(1000);
const restored = JSON.parse(readFileSync(CANVAS_FILE, 'utf8')).frames.find((f) => f.id === 'frame_thin');
check(
  "undo puts it back with the file's own size, not the minimum it was drawn at",
  restored && restored.width === before.width && restored.height === before.height,
  { before, restored },
);

await setView(page, 'board', { x: 60, y: 60, zoom: 0.25 });
await page.reload();
await waitForBoard(page, 2);
const pv = previewFrame(page);
await pv.locator('[data-colab-frame-title="frame_thin"]').click();
await page.waitForTimeout(300);
const title = await pv.locator('[data-colab-frame-title="frame_thin"]').boundingBox();
const frameBox = await pv.locator('[data-colab-chrome="frame_thin"]').boundingBox();
check('at 25% the frame is narrow on screen', frameBox.width < 40, frameBox);
check('… but its selected title keeps at least 56px', title.width >= 55.5, title);

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
