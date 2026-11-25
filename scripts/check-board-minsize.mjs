// A frame narrower than the minimum in the file is shown at the minimum width (task 6a).
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

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
