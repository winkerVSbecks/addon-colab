// A pin never attaches to a look-alike. The rule: a pin attaches only with positive
// evidence that it is the pinned element and not one of the look-alikes that existed when it was
// pinned; in doubt it detaches. Uses the check-only stories in scripts/fixtures/LookAlikes.stories.tsx
// and changes them through their own buttons, the way an app would:
// - keyed rows: prepend, keyed reverse, remove Row B, filter to C+D, filter to D only (the Row C and
//   Row A "Delete" pins detach), reset, remove Row C, rename Row C to Row B;
// - unkeyed rows (React rewrites rows in place): reverse twice;
// - cards: remove Alpha with its own Close (Alpha's pin detaches, Beta's stays);
// - header/footer, classed and sibling "Save" pairs: remove one, prepend one;
// - a unique button moved to another parent, Submit swapped for a disabled secondary Submit,
//   unlabeled duplicate inputs, images and boxes;
// - after a reload every pin is back on its original element.
// Needs a Storybook whose stories glob includes scripts/fixtures (`pnpm check:browser` starts one).
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6187 CANVAS_DIR=<its canvas dir> node scripts/check-board-comments-lookalikes.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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

const story = (name) => `checks-look-alikes--${name}`;
const FRAMES = [
  { id: 'f_rows', storyId: story('keyed-rows'), x: 0, y: 0, width: 300 },
  { id: 'f_unkeyed', storyId: story('unkeyed-rows'), x: 320, y: 0, width: 300 },
  { id: 'f_cards', storyId: story('card-list'), x: 640, y: 0, width: 260 },
  { id: 'f_misc', storyId: story('moves'), x: 920, y: 0, width: 420 },
  { id: 'f_hf', storyId: story('header-footer-saves'), x: 0, y: 470, width: 260 },
  { id: 'f_classed', storyId: story('classed-saves'), x: 280, y: 470, width: 260 },
  { id: 'f_siblings', storyId: story('sibling-saves'), x: 560, y: 470, width: 260 },
];

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
mkdirSync(new URL('.', CANVAS_FILE), { recursive: true });
writeFileSync(CANVAS_FILE, JSON.stringify({ ...BASE_CANVAS, frames: FRAMES }, null, 2) + '\n');
await new Promise((resolve) => setTimeout(resolve, 600));

const { browser, page, errors } = await launch({ dpr: 2, width: 1800, height: 1100 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 40, y: 50, zoom: 1 });
const open = async () => {
  await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
  await waitForBoard(page, FRAMES.length);
  await page.waitForTimeout(1200);
};
await open();
let pv = previewFrame(page);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

/** Pins a comment on `selector` in `frameId` (comment mode) and returns the stored comment. */
async function pinOn(frameId, selector, body) {
  await pv.locator('button[data-colab-mode="comment"]').click();
  const point = await modelPoint(page, frameId, selector);
  await page.mouse.click(point.x, point.y);
  await pv.locator('[data-colab-draft] textarea').fill(body);
  await pv.locator('[data-colab-submit="comment"]').click();
  await page.waitForTimeout(600);
  await pv.locator('button[data-colab-mode="select"]').click();
  return read().comments.at(-1);
}

/** Presses a story's own `data-action` button (the story's React handler runs). */
async function act(frameId, action) {
  await pv.evaluate(
    ({ frameId, action }) =>
      document.querySelector(`[data-colab-frame="${frameId}"] [data-action="${action}"]`).click(),
    { frameId, action },
  );
  await page.waitForTimeout(500);
}

/**
 * Where a pin is: `detached`, or attached on the element `find` returns (run in the story root),
 * judged by the pin's anchored point (bottom-left) sitting on that element's top-right corner.
 */
async function pinState(comment, frameId, find) {
  return pv.evaluate(
    ({ id, frameId, find }) => {
      const pin = document.querySelector(`[data-colab-pin="${id}"]`);
      const root = document.querySelector(`[data-colab-frame="${frameId}"] [data-colab-story-root]`);
      const element = find ? new Function('root', `return (${find})(root)`)(root) : null;
      const p = pin.getBoundingClientRect();
      const e = element?.getBoundingClientRect();
      const on = !!e && Math.abs(p.left - e.right) < 4 && Math.abs(p.bottom - e.top) < 4;
      return { state: pin.dataset.state, on, element: element?.outerHTML?.slice(0, 80) };
    },
    { id: comment.id, frameId, find: find?.toString() },
  );
}
async function expectOn(label, comment, frameId, find) {
  const at = await pinState(comment, frameId, find);
  check(label, at.state === 'attached' && at.on, at);
}
async function expectDetached(label, comment, frameId) {
  const at = await pinState(comment, frameId);
  check(label, at.state === 'detached', at);
}

// Finders, run inside the preview (no closures: they are sent as source).
const rowDelete = (label) =>
  `(root) => [...root.querySelectorAll('li')].find((li) => li.querySelector('span').textContent === ${JSON.stringify(label)})?.querySelector('button')`;
const rowSpan = (label) =>
  `(root) => [...root.querySelectorAll('li > span')].find((span) => span.textContent === ${JSON.stringify(label)})`;
const cardClose = (card) =>
  `(root) => [...root.querySelectorAll('.card')].find((c) => c.querySelector('h3').textContent === ${JSON.stringify(card)})?.querySelector('button')`;
const sel = (selector) => `(root) => root.querySelector(${JSON.stringify(selector)})`;

// ---------------------------------------------------------------------------------------------
console.log('Keyed rows');
const cDel = await pinOn('f_rows', 'li:nth-of-type(3) > button', 'Row C delete');
const aDel = await pinOn('f_rows', 'li:nth-of-type(1) > button', 'Row A delete');
const cText = await pinOn('f_rows', 'li:nth-of-type(3) > span', 'Row C text');
check('Row C Delete stored with its row', cDel.anchor.target.context === 'Row C Delete', cDel.anchor.target);
check('Row C Delete records its look-alikes', cDel.anchor.target.lookAlikes === 4, cDel.anchor.target);
const allOnTheirRows = async (when) => {
  await expectOn(`${when}: Row C Delete pin on Row C`, cDel, 'f_rows', rowDelete('Row C'));
  await expectOn(`${when}: Row A Delete pin on Row A`, aDel, 'f_rows', rowDelete('Row A'));
  await expectOn(`${when}: Row C text pin on Row C`, cText, 'f_rows', rowSpan('Row C'));
};
await allOnTheirRows('pinned');
await act('f_rows', 'prepend');
await allOnTheirRows('prepend');
await act('f_rows', 'reverse');
await allOnTheirRows('keyed reverse');
await act('f_rows', 'remove-b');
await allOnTheirRows('Row B removed');
await act('f_rows', 'only-c-d');
await expectOn('filtered to C, D: Row C Delete pin on Row C', cDel, 'f_rows', rowDelete('Row C'));
await expectOn('filtered to C, D: Row C text pin on Row C', cText, 'f_rows', rowSpan('Row C'));
await expectDetached('filtered to C, D: Row A Delete pin detached', aDel, 'f_rows');
await act('f_rows', 'only-d');
await expectDetached('filtered to D: Row C Delete pin detached (not on Row D)', cDel, 'f_rows');
await expectDetached('filtered to D: Row A Delete pin detached (not on Row D)', aDel, 'f_rows');
await expectDetached('filtered to D: Row C text pin detached', cText, 'f_rows');
await act('f_rows', 'reset');
await allOnTheirRows('reset');
await act('f_rows', 'remove-c');
await expectDetached('Row C removed: Row C Delete pin detached', cDel, 'f_rows');
await expectDetached('Row C removed: Row C text pin detached', cText, 'f_rows');
await expectOn('Row C removed: Row A Delete pin on Row A', aDel, 'f_rows', rowDelete('Row A'));
await act('f_rows', 'reset');
await allOnTheirRows('reset again');
await act('f_rows', 'rename-c');
await expectDetached('Row C renamed to Row B: Row C text pin detached', cText, 'f_rows');
await expectDetached('Row C renamed to Row B: Row C Delete pin detached', cDel, 'f_rows');
await act('f_rows', 'reset');
await allOnTheirRows('reset after rename');

console.log('Unkeyed rows');
const uDel = await pinOn('f_unkeyed', 'li:nth-of-type(3) > button', 'Row C delete (unkeyed)');
const uText = await pinOn('f_unkeyed', 'li:nth-of-type(3) > span', 'Row C text (unkeyed)');
for (const when of ['unkeyed reverse', 'unkeyed reverse back']) {
  await act('f_unkeyed', 'reverse');
  await expectOn(`${when}: Delete pin on the Delete now in Row C`, uDel, 'f_unkeyed', rowDelete('Row C'));
  await expectOn(`${when}: text pin on the span now saying Row C`, uText, 'f_unkeyed', rowSpan('Row C'));
}
await act('f_unkeyed', 'only-d');
await expectDetached('unkeyed, filtered to D: Delete pin detached', uDel, 'f_unkeyed');
await act('f_unkeyed', 'reset');

console.log('Cards');
const alpha = await pinOn('f_cards', '.card:nth-of-type(2) button', 'Alpha close');
const beta = await pinOn('f_cards', '.card:nth-of-type(3) button', 'Beta close');
check('Alpha Close stored with its card', alpha.anchor.target.context === 'Alpha ×', alpha.anchor.target);
await pv.evaluate(() => document.querySelector('[data-colab-frame="f_cards"] .card button').click());
await page.waitForTimeout(500);
await expectDetached("Alpha removed: Alpha's Close pin detached (not on Beta's)", alpha, 'f_cards');
await expectOn("Alpha removed: Beta's Close pin on Beta's", beta, 'f_cards', cardClose('Beta'));
await act('f_cards', 'reset');
await expectOn("reset: Alpha's Close pin back on Alpha's", alpha, 'f_cards', cardClose('Alpha'));

console.log('Save pairs');
const top = await pinOn('f_hf', 'header button', 'header save');
const bottom = await pinOn('f_hf', 'footer button', 'footer save');
check('header Save stored with the header text', top.anchor.target.context === 'Profile Save', top.anchor.target);
await act('f_hf', 'remove-first');
await expectDetached('header Save removed: its pin detached (not on the footer Save)', top, 'f_hf');
await expectOn('header Save removed: footer pin on the footer Save', bottom, 'f_hf', sel('footer button'));
await act('f_hf', 'reset');
await expectOn('reset: header pin back on the header Save', top, 'f_hf', sel('header button'));
await act('f_hf', 'remove-second');
await expectOn('footer Save removed: header pin on the header Save', top, 'f_hf', sel('header button'));
await expectDetached('footer Save removed: footer pin detached', bottom, 'f_hf');
await act('f_hf', 'reset');

const classed = await pinOn('f_classed', 'button.a', 'save a');
check(
  'button.a stored with look-alikes and no context',
  classed.anchor.target.lookAlikes === 2 && !classed.anchor.target.context,
  classed.anchor.target,
);
await act('f_classed', 'remove-first');
await expectDetached('button.a removed: its pin detached (not on button.b)', classed, 'f_classed');
await act('f_classed', 'reset');
await expectOn('reset: pin back on button.a', classed, 'f_classed', sel('button.a'));
await act('f_classed', 'remove-second');
await expectOn('button.b removed: pin still on button.a', classed, 'f_classed', sel('button.a'));
await act('f_classed', 'reset');

const sibling = await pinOn('f_siblings', '.bar button:nth-of-type(1)', 'first save');
await expectOn('first sibling Save pinned', sibling, 'f_siblings', sel('.bar button:nth-of-type(1)'));
await act('f_siblings', 'remove-first');
await expectDetached('first sibling removed: pin detached (not on the second)', sibling, 'f_siblings');
await act('f_siblings', 'reset');
await expectOn('reset: pin back on the first sibling', sibling, 'f_siblings', sel('.bar button:nth-of-type(1)'));
await act('f_siblings', 'prepend');
await expectDetached('a Save prepended: pin detached (its position holds another)', sibling, 'f_siblings');
await act('f_siblings', 'reset');

console.log('Moves, swaps, unlabeled duplicates');
const go = await pinOn('f_misc', '.left button', 'go');
const submit = await pinOn('f_misc', 'form button', 'submit');
const input = await pinOn('f_misc', '.inputs input:nth-of-type(1)', 'first input');
const image = await pinOn('f_misc', '.images img:nth-of-type(1)', 'first image');
const square = await pinOn('f_misc', '.boxes .box:nth-of-type(1)', 'first box');
await act('f_misc', 'move');
await expectOn('unique Go moved to another parent: pin follows', go, 'f_misc', sel('.right button'));
await act('f_misc', 'swap');
await expectOn('Submit swapped for a disabled secondary Submit: pin follows', submit, 'f_misc', sel('form button'));
await act('f_misc', 'remove-input');
await expectDetached('first unlabeled input removed: pin detached', input, 'f_misc');
await act('f_misc', 'remove-image');
await expectDetached('first unlabeled image removed: pin detached', image, 'f_misc');
await act('f_misc', 'remove-box');
await expectDetached('first empty box removed: pin detached', square, 'f_misc');

console.log('Styling and an unrelated hot reload');
await pv.evaluate(() => {
  const header = document.querySelector('[data-colab-frame="f_hf"] header button');
  header.style.cssText = 'color: red; background: yellow; padding: 10px 20px';
  header.classList.add('extra');
});
await page.waitForTimeout(500);
await expectOn('colour, padding and an added class: header Save pin stays', top, 'f_hf', sel('header button'));
const unrelated = new URL('./fixtures/Rows.stories.tsx', import.meta.url);
const original = readFileSync(unrelated, 'utf8');
writeFileSync(unrelated, `${original}// hot reload ${Date.now()}\n`);
await page.waitForTimeout(2500);
writeFileSync(unrelated, original);
await page.waitForTimeout(2500);
await allOnTheirRows('after an unrelated hot reload');
await expectOn('after an unrelated hot reload: header Save pin', top, 'f_hf', sel('header button'));
await expectOn('after an unrelated hot reload: button.a pin', classed, 'f_classed', sel('button.a'));

console.log('Reload');
await open();
pv = previewFrame(page);
await allOnTheirRows('after reload');
await expectOn('after reload: unkeyed Delete pin on Row C', uDel, 'f_unkeyed', rowDelete('Row C'));
await expectOn("after reload: Alpha's Close pin on Alpha's", alpha, 'f_cards', cardClose('Alpha'));
await expectOn('after reload: header Save pin', top, 'f_hf', sel('header button'));
await expectOn('after reload: footer Save pin', bottom, 'f_hf', sel('footer button'));
await expectOn('after reload: button.a pin', classed, 'f_classed', sel('button.a'));
await expectOn('after reload: first sibling pin', sibling, 'f_siblings', sel('.bar button:nth-of-type(1)'));
await expectOn('after reload: Go pin', go, 'f_misc', sel('.left button'));
await expectOn('after reload: first input pin', input, 'f_misc', sel('.inputs input:nth-of-type(1)'));
await expectOn('after reload: first image pin', image, 'f_misc', sel('.images img:nth-of-type(1)'));
await expectOn('after reload: first box pin', square, 'f_misc', sel('.boxes .box:nth-of-type(1)'));

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
