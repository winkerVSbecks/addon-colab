// The board's one undo stack: a second removal no longer drops the first, ⌘Z undoes
// them in reverse order, ⇧⌘Z redoes, and a later notice does not take an earlier undo away.
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6171 CANVAS_DIR=<its canvas dir> node scripts/check-board-undo-stack.mjs
import { readFileSync } from 'node:fs';

import { CANVAS_FILE, SB, check, done, launch, previewFrame, resetCanvas, setView, waitForBoard } from './board-lib.mjs';

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
const ids = () => read().frames.map((f) => f.id).sort().join(' ');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
await resetCanvas();

const { browser, page, errors } = await launch({ dpr: 2 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 60, zoom: 0.75 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const preview = previewFrame(page);
await page.waitForTimeout(1500);
const notice = preview.locator('[data-colab-board-notice]');
const all = 'frame_btn frame_hdr frame_page';

// Two removals in a row.
await preview.locator('[data-colab-frame-title="frame_hdr"]').click();
await page.keyboard.press('Delete');
await notice.waitFor();
await preview.locator('[data-colab-frame-title="frame_btn"]').click();
await page.keyboard.press('Delete');
await page.waitForTimeout(700);
check('both frames are removed', ids() === 'frame_page', ids());
check('the latest notice names the second removal and offers Undo', /Removed .*Button/.test(await notice.textContent()), await notice.textContent());

// ⌘Z twice brings both back, latest first.
await page.keyboard.press(`${mod}+z`);
await page.waitForTimeout(700);
check('first ⌘Z restores the latest removal', ids() === 'frame_btn frame_page', ids());
await page.keyboard.press(`${mod}+z`);
await page.waitForTimeout(700);
check('second ⌘Z restores the earlier removal too', ids() === all, ids());
await waitForBoard(page, 3);

// ⇧⌘Z redoes the last undo (removes the Header again), and ⌘Z undoes it once more.
await page.keyboard.press(`${mod}+Shift+z`);
await page.waitForTimeout(700);
check('⇧⌘Z redoes: Header removed again', ids() === 'frame_btn frame_page', ids());
await page.keyboard.press(`${mod}+z`);
await page.waitForTimeout(700);
check('⌘Z after redo restores it', ids() === all, ids());

// The undo outlives its notice: once the notice has timed out, ⌘Z still restores the frame.
await waitForBoard(page, 3);
await preview.locator('[data-colab-frame-title="frame_page"]').click();
await page.keyboard.press('Delete');
await notice.waitFor();
await page.waitForTimeout(10500);
check('the Undo notice has timed out', (await notice.count()) === 0);
await page.keyboard.press(`${mod}+z`);
await page.waitForTimeout(800);
check('⌘Z still undoes after its notice has gone', ids() === all, ids());

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
