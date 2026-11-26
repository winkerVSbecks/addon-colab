// Zoom to fit includes comment pins: a position comment at (-200, -150), outside every
// frame, is on screen after Zoom to fit, and so are all frames.
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6177 CANVAS_DIR=<its canvas dir> node scripts/check-board-fit.mjs
import { writeFileSync } from 'node:fs';

import {
  BASE_CANVAS,
  CANVAS_FILE,
  SB,
  check,
  done,
  launch,
  previewFrame,
  setView,
  waitForBoard,
} from './board-lib.mjs';

const comment = {
  id: 'comment-far01',
  author: 'agent',
  body: 'Room for a footer story up here?',
  status: 'open',
  anchor: { type: 'position', x: -200, y: -150 },
  createdAt: '2026-11-25T12:00:00.000Z',
  replies: [],
};
writeFileSync(CANVAS_FILE, JSON.stringify({ ...BASE_CANVAS, comments: [comment] }, null, 2) + '\n');
await new Promise((resolve) => setTimeout(resolve, 600));

const { browser, page, errors } = await launch({ dpr: 2, width: 1600, height: 960 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 600, y: 500, zoom: 1.5 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const pv = previewFrame(page);
await pv.getByRole('button', { name: 'Zoom to fit stories and comments' }).click();
await page.waitForTimeout(500);
const seen = await pv.evaluate(() => {
  const board = document.querySelector('[data-colab-board]').getBoundingClientRect();
  const inside = (element) => {
    const r = element.getBoundingClientRect();
    return r.left >= board.left && r.top >= board.top && r.right <= board.right && r.bottom <= board.bottom;
  };
  return {
    pin: inside(document.querySelector('[data-colab-pin="comment-far01"]')),
    frames: [...document.querySelectorAll('[data-colab-frame]')].map(inside),
  };
});
check('the far comment pin is on screen after Zoom to fit', seen.pin, seen);
check('… and so is every frame', seen.frames.length === 3 && seen.frames.every(Boolean), seen);
check('no page errors', errors.length === 0, errors);
await browser.close();
done();
