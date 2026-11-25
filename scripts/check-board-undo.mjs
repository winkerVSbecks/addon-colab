// Undo for removing a frame (task 6a): the frame returns with the same id, position, size and place
// in the stacking order, from the notice's Undo button or with ⌘Z / Ctrl+Z while it shows; focus
// moves to the board after a removal.
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6170 CANVAS_DIR=.sb-6a/canvases node scripts/check-board-undo.mjs
import { readFileSync } from 'node:fs';

import { CANVAS_FILE, SB, boardState, check, done, launch, previewFrame, resetCanvas, setView, waitForBoard } from './board-lib.mjs';

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
await resetCanvas();

const { browser, page, errors } = await launch({ dpr: 2 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 60, zoom: 0.75 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const preview = previewFrame(page);
await page.waitForTimeout(1800); // measured heights are saved
const before = read().frames;
const notice = preview.locator('[data-colab-board-notice]');
const focus = () =>
  preview.evaluate(() => {
    const active = document.activeElement;
    return active?.hasAttribute('data-colab-board') ? 'board' : (active?.tagName ?? null);
  });

// 1. Remove the middle frame with Delete on its title, then Undo from the notice.
await preview.locator('[data-colab-frame-title="frame_hdr"]').click();
await page.keyboard.press('Delete');
await notice.waitFor();
check('notice names the removed story and offers Undo', /Removed .*Header/.test(await notice.textContent()) && (await notice.locator('button').textContent()) === 'Undo', await notice.textContent());
check('focus moves to the board after a removal', (await focus()) === 'board', await focus());
await page.waitForTimeout(600);
check('frame is gone from the file', !read().frames.some((f) => f.id === 'frame_hdr'));
check('frame is gone from the board', (await preview.locator('[data-colab-frame="frame_hdr"]').count()) === 0);
await notice.locator('button').click();
await waitForBoard(page, 3);
await page.waitForTimeout(600);
check('Undo restores the frame with the same id, position, size and order', same(read().frames, before), { before, after: read().frames });
check('the restored frame is selected', (await boardState(page)).selectedId === 'frame_hdr');
check('the notice is gone after Undo', (await notice.count()) === 0);

// 2. Remove with the Remove button, then undo with the keyboard.
await preview.locator('[data-colab-frame-title="frame_btn"]').click();
await preview.locator('[data-colab-chrome="frame_btn"] button[aria-label="Remove from canvas"]').click();
await notice.waitFor();
check('focus moves to the board after the Remove button', (await focus()) === 'board', await focus());
await page.waitForTimeout(600);
check('frame is gone from the file (Remove button)', !read().frames.some((f) => f.id === 'frame_btn'));
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
await waitForBoard(page, 3);
await page.waitForTimeout(600);
check('⌘Z restores it in place (first in the order)', same(read().frames, before), read().frames.map((f) => f.id));

// 3. Undo pressed right away, before the removal has been written.
await preview.locator('[data-colab-frame-title="frame_page"]').click();
await page.keyboard.press('Delete');
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
await waitForBoard(page, 3);
await page.waitForTimeout(800);
check('an immediate ⌘Z still ends with the frame back', same(read().frames, before), read().frames.map((f) => f.id));

// 4. ⌘Z with no notice showing does nothing.
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
await page.waitForTimeout(400);
check('⌘Z with nothing to undo changes nothing', same(read().frames, before));

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
