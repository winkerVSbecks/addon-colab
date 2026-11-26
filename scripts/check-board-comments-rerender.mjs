// Comments when stories re-render, and against story CSS:
// - a pin on the Page story's "Sign up" detaches (falls back to its frame, marked) when the story
//   logs in and the button goes, and comes back to the button when it logs out again;
// - the comment UI keeps its text styles, pin size and list width when a story's global CSS
//   (universal, tag and attribute rules) is on the page.
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6171 CANVAS_DIR=<its canvas dir> node scripts/check-board-comments-rerender.mjs
import { readFileSync } from 'node:fs';

import {
  CANVAS_FILE,
  SB,
  check,
  done,
  launch,
  modelPoint,
  previewFrame,
  resetCanvas,
  setView,
  waitForBoard,
} from './board-lib.mjs';

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
await resetCanvas();
const { browser, page, errors } = await launch({ dpr: 2, width: 1800, height: 1000 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const pv = previewFrame(page);
await page.waitForTimeout(1200);

// Pin a comment on the Page story's Sign up.
await pv.locator('button[data-colab-mode="comment"]').click();
const signUp = await modelPoint(page, 'frame_page', '.storybook-button--primary');
await page.mouse.click(signUp.x, signUp.y);
await pv.locator('[data-colab-draft] textarea').fill('Sign up needs more contrast');
await pv.locator('[data-colab-submit="comment"]').click();
await page.waitForTimeout(700);
const comment = read().comments[0];
check(
  'pinned to the Page story’s Sign up',
  comment?.anchor.target?.name === 'Sign up' && comment.anchor.frameId === 'frame_page',
  comment?.anchor,
);
const pin = pv.locator(`[data-colab-pin="${comment.id}"]`);
const state = () => pin.getAttribute('data-state');
check('the pin starts attached', (await state()) === 'attached');
const attachedBox = await pin.boundingBox();

// Log in inside the story (select mode): Sign up disappears.
await pv.locator('button[data-colab-mode="select"]').click();
const logIn = await modelPoint(page, 'frame_page', '.storybook-button--secondary');
await page.mouse.click(logIn.x, logIn.y);
await page.waitForTimeout(800);
check(
  'the story re-rendered (logged in)',
  /Welcome/.test(await pv.locator('[data-colab-frame="frame_page"]').textContent()),
);
check('the pin is detached once its element is gone', (await state()) === 'detached');
const frameBox = await pv.locator('[data-colab-frame="frame_page"]').boundingBox();
const detachedBox = await pin.boundingBox();
check(
  '… and sits at its frame’s corner',
  Math.abs(detachedBox.x - frameBox.x) < 2 && Math.abs(detachedBox.y - frameBox.y) < 2,
  { detachedBox, frameBox },
);

// Log out: Sign up is back, and so is the pin.
const logOut = await modelPoint(page, 'frame_page', '.storybook-button--secondary');
await page.mouse.click(logOut.x, logOut.y);
await page.waitForTimeout(800);
check('the pin re-attaches when the element comes back', (await state()) === 'attached');
const again = await pin.boundingBox();
check('… at the button again', Math.abs(again.x - attachedBox.x) < 2 && Math.abs(again.y - attachedBox.y) < 2, {
  again,
  attachedBox,
});

// Story CSS leaking into the board's page.
await pin.click();
await pv.locator('[data-colab-comments-toggle]').click();
await page.waitForTimeout(300);
const probe = () =>
  pv.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return [
        style.fontFamily,
        style.fontSize,
        style.lineHeight,
        style.color,
        style.textTransform,
        style.letterSpacing,
        style.boxSizing,
        style.margin,
        Math.round(rect.width),
        Math.round(rect.height),
      ].join(' | ');
    };
    return {
      pin: read('[data-colab-pin]'),
      thread: read('[data-colab-thread]'),
      body: read('[data-colab-thread] p'),
      item: read('[data-colab-list-item]'),
      list: read('[data-colab-comment-list] h2'),
    };
  });
const clean = await probe();
await pv.evaluate(() => {
  const style = document.createElement('style');
  style.id = 'hostile';
  style.textContent = `
    * { margin: 7px; font: 22px/3 serif; color: red; letter-spacing: 3px; text-transform: uppercase; box-sizing: content-box; }
    button { background: yellow; border: 5px solid red; padding: 12px; width: 200px; }
    p, h2, span { margin: 20px; font-size: 30px; }
    div { border: 2px dotted green; }
    aside, ul, li { margin: 20px; padding: 20px; }
    [aria-label] { min-width: 100px; }`;
  document.head.append(style);
});
await page.waitForTimeout(300);
const hostile = await probe();
// Text (font, size, line height, colour, case, spacing, box sizing, margin) must not change anywhere;
// sizes must not change for the pin and the list items. Known limit: Storybook's own components
// inside the thread (Popover wrapper, Badge, ToggleButton label font) inherit from the page, so a
// story's universal rule can still change their spacing; see the task note.
const text = (value) => value?.split(' | ').slice(0, 8).join(' | ');
for (const key of Object.keys(clean)) {
  check(
    `story CSS does not change the text of the comment ${key}`,
    clean[key] !== null && text(clean[key]) === text(hostile[key]),
    { clean: clean[key], hostile: hostile[key] },
  );
}
check('story CSS does not change the pin’s size', clean.pin === hostile.pin, {
  clean: clean.pin,
  hostile: hostile.pin,
});
const width = (value) => value?.split(' | ')[8];
check('story CSS does not change the list item’s width', width(clean.item) === width(hostile.item), {
  clean: clean.item,
  hostile: hostile.item,
});
await page.screenshot({ path: process.env.SHOT ?? `${process.env.TMPDIR ?? '/tmp'}/comments-hostile-css.png` });

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
