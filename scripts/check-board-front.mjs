// Bring to front (task 6a): selecting a frame raises it above the others, so a huge frame cannot
// cover the rest for good. The order is saved (frame order in the file is the stacking order).
// Rewrites $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6170 CANVAS_DIR=.sb-6a/canvases node scripts/check-board-front.mjs [screenshot.png]
import { readFileSync, writeFileSync } from 'node:fs';

import { BASE_CANVAS, CANVAS_FILE, SB, boardState, check, done, launch, modelPoint, previewFrame, setView, waitForBoard } from './board-lib.mjs';

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
const order = (frames) => frames.map((f) => f.id).join(' ');
// Button and Header first, then a huge Page frame that covers both.
writeFileSync(
  CANVAS_FILE,
  JSON.stringify(
    {
      ...BASE_CANVAS,
      frames: [
        { id: 'frame_btn', storyId: 'example-button--primary', x: 40, y: 140, width: 360 },
        { id: 'frame_hdr', storyId: 'example-header--logged-out', x: 440, y: 300, width: 700 },
        { id: 'frame_huge', storyId: 'example-page--logged-out', x: 0, y: 0, width: 8000, height: 5000 },
      ],
    },
    null,
    2,
  ) + '\n',
);
await new Promise((resolve) => setTimeout(resolve, 600));

const { browser, page, errors } = await launch({ dpr: 2 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 40, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const preview = previewFrame(page);
await page.waitForTimeout(1800);

const clicks = () => preview.evaluate(() => window.__clicks ?? []);
await preview.evaluate(() => {
  window.__clicks = [];
  document.addEventListener('click', (event) => {
    const frame = event.target.closest?.('[data-colab-frame]');
    if (frame) window.__clicks.push(`${frame.dataset.colabFrame}:${event.target.tagName}`);
  }, true);
});

// 1. Covered: a click where the Button story is lands on the huge frame.
const button = await modelPoint(page, 'frame_btn', 'button');
await page.mouse.click(button.x, button.y);
check('at first the huge frame covers the Button story', (await clicks()).at(-1)?.startsWith('frame_huge'), await clicks());

// 2. Select the covered frame by its title: it comes to the front and gets the clicks.
await preview.locator('[data-colab-frame-title="frame_btn"]').click();
await page.waitForTimeout(700);
check('the title of a covered frame brings it to the front (board)', order((await boardState(page)).frames) === 'frame_hdr frame_huge frame_btn', order((await boardState(page)).frames));
check('… and the order is saved in the file', order(read().frames) === 'frame_hdr frame_huge frame_btn', order(read().frames));
await page.mouse.click(button.x, button.y);
check('the raised Button story now gets the click', (await clicks()).at(-1) === 'frame_btn:BUTTON', await clicks());
const domOrder = await preview.evaluate(() => [...document.querySelectorAll('[data-colab-frame]')].map((e) => e.dataset.colabFrame).join(' '));
check('DOM order did not change (no node was moved)', domOrder === 'frame_btn frame_hdr frame_huge', domOrder);

// 3. Raise the Header by its title, then press its button: the press itself keeps working.
await preview.locator('[data-colab-frame-title="frame_hdr"]').click();
await page.waitForTimeout(700);
check('raising another frame puts it last', order(read().frames) === 'frame_huge frame_btn frame_hdr', order(read().frames));
const login = await modelPoint(page, 'frame_hdr', 'button');
await page.mouse.click(login.x, login.y);
await page.waitForTimeout(300);
check('a click on the raised Header reaches its button', (await clicks()).at(-1) === 'frame_hdr:BUTTON', await clicks());

// 4. Press inside the huge frame (away from the others): it comes to the front again, and the
//    press that raised it still reaches the story.
const { iframe } = await boardState(page);
const before = (await clicks()).length;
await page.mouse.click(iframe.x + 40 + 500, iframe.y + 60 + 620);
await page.waitForTimeout(700);
check('a press inside a frame raises it', order(read().frames) === 'frame_btn frame_hdr frame_huge', order(read().frames));
check('… and the same press reaches the story', (await clicks()).length === before + 1 && (await clicks()).at(-1).startsWith('frame_huge'), await clicks());

// 5. Selecting the top frame again writes nothing.
const stamp = read().updatedAt;
await page.mouse.click(iframe.x + 40 + 500, iframe.y + 60 + 620);
await page.waitForTimeout(500);
check('selecting the frame that is already on top writes nothing', read().updatedAt === stamp);

// 6. The order survives a reload.
await preview.locator('[data-colab-frame-title="frame_btn"]').click();
await page.waitForTimeout(700);
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await page.reload();
await waitForBoard(page, 3);
check('the order survives a reload', order((await boardState(page)).frames) === 'frame_hdr frame_huge frame_btn', order((await boardState(page)).frames));
const afterReload = await modelPoint(page, 'frame_btn', 'button');
await previewFrame(page).evaluate(() => {
  window.__clicks = [];
  document.addEventListener('click', (event) => {
    const frame = event.target.closest?.('[data-colab-frame]');
    if (frame) window.__clicks.push(`${frame.dataset.colabFrame}:${event.target.tagName}`);
  }, true);
});
await page.mouse.click(afterReload.x, afterReload.y);
check('… and the raised frame still gets the click', (await previewFrame(page).evaluate(() => window.__clicks)).at(-1) === 'frame_btn:BUTTON');

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
