// "Add to canvas" from the toolbar: adds the open story to the chosen canvas, to the right of its
// other frames, and the notification opens the canvas. Hidden on canvas pages.
// Run: SB=http://127.0.0.1:6160 node scripts/check-board-add.mjs 
import { readFileSync } from 'node:fs';

import { CANVAS_FILE, SB, check, done, launch, resetCanvas, waitForBoard } from './board-lib.mjs';

await resetCanvas();
const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
const before = read();
const right = Math.max(...before.frames.map((f) => f.x + f.width));
const top = Math.min(...before.frames.map((f) => f.y));

const { browser, page, errors } = await launch({ dpr: 2 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, before.frames.length);
check('no "Add to canvas" button on a canvas page', (await page.getByRole('switch', { name: 'Add to canvas' }).count()) === 0);

await page.goto(`${SB}/?path=/story/example-header--logged-in`);
await page.getByRole('switch', { name: 'Add to canvas' }).click();
await page.getByRole('button', { name: /^Board/ }).click();
await page.waitForTimeout(800);
const after = read();
const added = after.frames.find((f) => !before.frames.some((b) => b.id === f.id));
check('story added to the canvas file', added?.storyId === 'example-header--logged-in', after.frames);
check('placed right of the other frames, top-aligned', added?.x === right + 80 && added?.y === top, added);
check('fullscreen story gets the wide default width', added?.width === 960, added);
const notification = page.getByText('Added to Board');
check('confirmation notification shown', await notification.isVisible());
await notification.click();
await page.waitForURL(/colab-canvas-board--canvas/, { timeout: 5000 }).catch(() => undefined);
check('clicking the notification opens the canvas', page.url().includes('colab-canvas-board--canvas'), page.url());
await waitForBoard(page, after.frames.length);
check('no page errors', errors.length === 0, errors);
await browser.close();
await resetCanvas();
done();
