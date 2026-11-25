// A pin never sits on a different element (task 7a). Cases from the task 7 verification:
// - pin the Page story's "Log in", log in inside the story: the pin detaches (never moves onto
//   "Log out"), and comes back to "Log in" after logging out;
// - pin "Row C" (a span, no role or name) and Row C's "Delete" (a name every row shares) in the
//   check-only Rows story, prepend a row: both pins stay on Row C; reverse the list (a keyed
//   reorder): both still on Row C.
// Needs the check-only story in scripts/fixtures (a Storybook started with `-c .sb-7a`).
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6177 CANVAS_DIR=.sb-7a/canvases node scripts/check-board-comments-match.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import {
  BASE_CANVAS,
  CANVAS_FILE,
  SB,
  check,
  done,
  launch,
  modelPoint,
  previewFrame,
  setView,
  waitForBoard,
} from './board-lib.mjs';

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
mkdirSync(new URL('.', CANVAS_FILE), { recursive: true });
writeFileSync(
  CANVAS_FILE,
  JSON.stringify(
    {
      ...BASE_CANVAS,
      frames: [
        { id: 'frame_page', storyId: 'example-page--logged-out', x: 0, y: 0, width: 960 },
        { id: 'frame_rows', storyId: 'checks-rows--default', x: 1000, y: 0, width: 360 },
      ],
    },
    null,
    2,
  ) + '\n',
);
await new Promise((resolve) => setTimeout(resolve, 600));

const { browser, page, errors } = await launch({
  dpr: 2,
  width: 1800,
  height: 1000,
  colorScheme: process.env.SCHEME ?? 'light',
});
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 40, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 2);
const pv = previewFrame(page);
await page.waitForTimeout(1200);

/** Pins a comment on `selector` in `frameId` (comment mode) and returns the stored comment. */
async function pinOn(frameId, selector, body) {
  await pv.locator('button[data-colab-mode="comment"]').click();
  const point = await modelPoint(page, frameId, selector);
  await page.mouse.click(point.x, point.y);
  await pv.locator('[data-colab-draft] textarea').fill(body);
  await pv.locator('[data-colab-submit="comment"]').click();
  await page.waitForTimeout(700);
  return read().comments.at(-1);
}

/** The pin's anchored point (its bottom-left) and the element's top-right, in page pixels. */
async function pinAndElement(commentId, frameId, selector) {
  const iframe = await (await page.$('#storybook-preview-iframe')).boundingBox();
  return pv.evaluate(
    ({ commentId, frameId, selector, iframe }) => {
      const pin = document.querySelector(`[data-colab-pin="${commentId}"]`);
      const root = document.querySelector(`[data-colab-frame="${frameId}"] [data-colab-story-root]`);
      const element = root?.querySelector(selector);
      const p = pin.getBoundingClientRect();
      const e = element?.getBoundingClientRect();
      return {
        state: pin.dataset.state,
        pin: { x: p.left + iframe.x, y: p.bottom + iframe.y },
        element: e && { x: e.right + iframe.x, y: e.top + iframe.y },
        text: element?.closest('li')?.querySelector('span')?.textContent ?? element?.textContent,
      };
    },
    { commentId, frameId, selector, iframe },
  );
}
const near = (a) => a.element && Math.abs(a.pin.x - a.element.x) < 4 && Math.abs(a.pin.y - a.element.y) < 4;

// 1. "Log in" on the Page story.
const login = await pinOn('frame_page', '.storybook-button--secondary', 'Log in should be a link');
check('pinned to "Log in"', login?.anchor.target?.name === 'Log in', login?.anchor.target);
await pv.locator('button[data-colab-mode="select"]').click();
const loginButton = await modelPoint(page, 'frame_page', '.storybook-button--secondary');
await page.mouse.click(loginButton.x, loginButton.y);
await page.waitForTimeout(800);
const logoutText = await pv.locator('[data-colab-frame="frame_page"] .storybook-button--secondary').textContent();
check('the story logged in (the same selector now matches "Log out")', logoutText.trim() === 'Log out', logoutText);
let at = await pinAndElement(login.id, 'frame_page', '.storybook-button--secondary');
check('the "Log in" pin is detached, not on "Log out"', at.state === 'detached' && !near(at), at);
const logoutButton = await modelPoint(page, 'frame_page', '.storybook-button--secondary');
await page.mouse.click(logoutButton.x, logoutButton.y);
await page.waitForTimeout(800);
at = await pinAndElement(login.id, 'frame_page', '.storybook-button--secondary');
check('after logging out it is back on "Log in"', at.state === 'attached' && near(at) && at.text === 'Log in', at);

// 2. Repeated rows.
const rowC = await pinOn('frame_rows', 'li:nth-of-type(3) > span', 'Row C is misaligned');
const deleteC = await pinOn('frame_rows', 'li:nth-of-type(3) > button', 'Row C delete needs a confirm');
check('the span is stored with its text', rowC?.anchor.target?.text === 'Row C', rowC?.anchor.target);
check(
  'the Delete button is stored with its row (context)',
  deleteC?.anchor.target?.name === 'Delete' && deleteC.anchor.target.context === 'Row C Delete',
  deleteC?.anchor.target,
);
await pv.locator('button[data-colab-mode="select"]').click();

const rowCSpan = (rows) => `li:nth-of-type(${rows.indexOf('Row C') + 1}) > span`;
const rowCButton = (rows) => `li:nth-of-type(${rows.indexOf('Row C') + 1}) > button`;
const rowsNow = () =>
  pv.evaluate(() =>
    [...document.querySelectorAll('[data-colab-frame="frame_rows"] li > span')].map((s) => s.textContent),
  );

for (const action of ['prepend', 'reverse']) {
  const button = await modelPoint(page, 'frame_rows', `[data-action="${action}"]`);
  await page.mouse.click(button.x, button.y);
  await page.waitForTimeout(800);
  const rows = await rowsNow();
  const span = await pinAndElement(rowC.id, 'frame_rows', rowCSpan(rows));
  const del = await pinAndElement(deleteC.id, 'frame_rows', rowCButton(rows));
  check(
    `after ${action} (${rows.join(', ')}), the "Row C" pin is on Row C`,
    span.state === 'attached' && near(span),
    span,
  );
  check(
    `after ${action}, the Delete pin is on Row C's Delete`,
    del.state === 'attached' && near(del) && del.text === 'Row C',
    del,
  );
}

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
