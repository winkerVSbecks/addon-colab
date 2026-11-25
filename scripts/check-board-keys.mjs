// Keyboard on the board (task 6a): keys pressed inside a story belong to the story.
// - Clicking plain text in a story, then Backspace or Delete, does not remove its frame.
// - Space on a focused button inside a story activates it (Page: "Log in" logs in).
// - Space+drag still pans when the board itself has focus; a frame's title still removes with Delete.
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6170 CANVAS_DIR=.sb-6a/canvases node scripts/check-board-keys.mjs
import { readFileSync } from 'node:fs';

import { CANVAS_FILE, SB, boardState, check, done, launch, modelPoint, previewFrame, resetCanvas, setView, waitForBoard } from './board-lib.mjs';

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
const ids = (frames) => frames.map((f) => f.id).sort();
await resetCanvas();

const { browser, page, errors } = await launch({ dpr: 2 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 60, zoom: 0.75 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const preview = previewFrame(page);
const activeTag = () => preview.evaluate(() => document.activeElement?.tagName);

// 1. Click the heading inside the Page story, press Backspace, then Delete.
const heading = await modelPoint(page, 'frame_page', 'h2');
await page.mouse.click(heading.x, heading.y);
let state = await boardState(page);
check('a press inside the story selects its frame', state.selectedId === 'frame_page', state.selectedId);
await page.keyboard.press('Backspace');
await page.keyboard.press('Delete');
await page.waitForTimeout(800);
state = await boardState(page);
check('Backspace/Delete after clicking story text keep the frame (board)', ids(state.frames).includes('frame_page'), ids(state.frames));
check('… and in the file', ids(read().frames).includes('frame_page'), ids(read().frames));

// 2. Focus "Log in" in the Page story and press Space: it logs in.
await preview.evaluate(() => {
  const button = [...document.querySelectorAll('[data-colab-frame="frame_page"] button')].find((b) => b.textContent === 'Log in');
  button.focus();
});
check('Log in has focus', (await activeTag()) === 'BUTTON');
await page.keyboard.press('Space');
await page.waitForTimeout(300);
const pageButtons = await preview.evaluate(() =>
  [...document.querySelectorAll('[data-colab-frame="frame_page"] button')].map((b) => b.textContent),
);
check('Space on "Log in" logs in (Log out shown)', pageButtons.includes('Log out') && !pageButtons.includes('Log in'), pageButtons);
check('… and the frame is still there', ids((await boardState(page)).frames).length === 3);

// 3. Space+drag pans when the board has focus (press on empty space first).
const { iframe } = await boardState(page);
await page.mouse.click(iframe.x + iframe.width - 40, iframe.y + iframe.height - 120);
const before = (await boardState(page)).view;
await page.keyboard.down('Space');
await page.mouse.move(iframe.x + 400, iframe.y + 150);
await page.mouse.down();
await page.mouse.move(iframe.x + 480, iframe.y + 210, { steps: 5 });
await page.mouse.up();
await page.keyboard.up('Space');
const after = (await boardState(page)).view;
check('Space+drag on the focused board pans', after.x - before.x === 80 && after.y - before.y === 60, { before, after });

// 4. The frame's own title still removes it with Delete.
await preview.locator('[data-colab-frame-title="frame_btn"]').click();
await page.keyboard.press('Delete');
await page.waitForTimeout(800);
check('Delete on a frame title removes that frame', !ids(read().frames).includes('frame_btn'), ids(read().frames));

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
