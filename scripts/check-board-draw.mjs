// Drawing on the board (task 8): draw mode, pen, eraser, undo/redo, clear-all, live remote strokes,
// and stroke alignment proved from the stroke layer's own pixels (not from screenshots): a box drawn
// around a story's button must still enclose that button's getBoundingClientRect at zoom 0.5 and 2,
// after a reload, at DPR 1 and 2, and with hostile story CSS on the page.
// Resets $CANVAS_DIR/board.json. Run:
//   SB=http://127.0.0.1:6180 CANVAS_DIR=.sb-task8/canvases node scripts/check-board-draw.mjs
import { readFileSync, writeFileSync } from 'node:fs';

import {
  BASE_CANVAS,
  CANVAS_FILE,
  SB,
  boardState,
  check,
  done,
  launch,
  previewFrame,
  resetCanvas,
  setView,
  waitForBoard,
} from './board-lib.mjs';

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
const BUTTON = '[data-colab-frame="frame_btn"] button';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function waitForFile(predicate, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (predicate(read())) return true;
    } catch {
      // Mid-write.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** The button's rect and the board's offset, in page coordinates. */
async function buttonRect(page) {
  const { iframe } = await boardState(page);
  const rect = await previewFrame(page).evaluate((selector) => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, BUTTON);
  return {
    left: rect.left + iframe.x,
    top: rect.top + iframe.y,
    right: rect.right + iframe.x,
    bottom: rect.bottom + iframe.y,
  };
}

/**
 * Where the saved stroke layer has ink, in page coordinates: the bounding box of its non-transparent
 * pixels, converted from device pixels to CSS pixels and offset by the layer's own position.
 */
async function inkBounds(page) {
  const { iframe } = await boardState(page);
  const box = await previewFrame(page).evaluate(() => {
    const canvas = document.querySelector('[data-colab-stroke-layer="saved"]');
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 64) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (left === Infinity) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = width / rect.width;
    const sy = height / rect.height;
    return {
      left: rect.left + left / sx,
      top: rect.top + top / sy,
      right: rect.left + (right + 1) / sx,
      bottom: rect.top + (bottom + 1) / sy,
      backing: { width, height, cssWidth: rect.width, cssHeight: rect.height, dpr: devicePixelRatio },
    };
  });
  return (
    box && {
      ...box,
      left: box.left + iframe.x,
      top: box.top + iframe.y,
      right: box.right + iframe.x,
      bottom: box.bottom + iframe.y,
    }
  );
}

/** The stroke's screen bounds from the file and the board's viewport (the model, for comparison). */
async function modelBounds(page, stroke) {
  const { view, iframe } = await boardState(page);
  const boardRect = await previewFrame(page).evaluate(() => {
    const r = document.querySelector('[data-colab-board]').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const xs = stroke.points.map(([x]) => x);
  const ys = stroke.points.map(([, y]) => y);
  const half = stroke.width / 2;
  const toX = (x) => iframe.x + boardRect.left + view.x + x * view.zoom;
  const toY = (y) => iframe.y + boardRect.top + view.y + y * view.zoom;
  return {
    left: toX(Math.min(...xs) - half),
    top: toY(Math.min(...ys) - half),
    right: toX(Math.max(...xs) + half),
    bottom: toY(Math.max(...ys) + half),
  };
}

const encloses = (outer, inner) =>
  outer && outer.left < inner.left && outer.top < inner.top && outer.right > inner.right && outer.bottom > inner.bottom;
const near = (a, b, tolerance) =>
  a && b && ['left', 'top', 'right', 'bottom'].every((key) => Math.abs(a[key] - b[key]) <= tolerance);

/** Two animation frames: the board canvas repaints (and its elements' rects update) on its next paint. */
const settle = (page) =>
  previewFrame(page).evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

async function checkAligned(page, label) {
  await settle(page);
  const stroke = read().strokes[0];
  const button = await buttonRect(page);
  const ink = await inkBounds(page);
  const model = await modelBounds(page, stroke);
  const { view } = await boardState(page);
  check(`${label}: drawn box encloses the button (zoom ${view.zoom})`, encloses(ink, button), { ink, button });
  // The quadratic smoothing rounds the corners inwards a little; the ink stays within the model box.
  check(`${label}: ink matches the stroke's world bounds on screen`, near(ink, model, 2 + 4 * view.zoom), {
    ink,
    model,
  });
}

async function openBoard(options = {}) {
  const session = await launch({ dpr: 2, ...options });
  await session.page.goto(`${SB}/`);
  await setView(session.page, 'board', { x: 80, y: 80, zoom: 1 });
  await session.page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
  await waitForBoard(session.page, 3);
  return session;
}

const mode = (page) => boardState(page).then((state) => state.mode);

await resetCanvas();
const { browser, page, errors } = await openBoard();
await page.waitForTimeout(1500); // measured heights are saved

// 1. Draw mode from the switcher; the options show.
await previewFrame(page).locator('button[data-colab-mode="draw"]').click();
check('draw mode is on', (await mode(page)) === 'draw');
check(
  'drawing options show in draw mode',
  (await previewFrame(page).locator('[data-colab-draw-options]').count()) === 1,
);

// 2. Draw a box around the Primary button. The presses must not reach the story, select, raise or pan.
await previewFrame(page).evaluate((selector) => {
  window.__clicks = 0;
  document.querySelector(selector).addEventListener('click', () => (window.__clicks += 1));
}, BUTTON);
const framesBefore = (await boardState(page)).frames.map((f) => f.id).join(' ');
const viewBefore = (await boardState(page)).view;
const b = await buttonRect(page);
const m = 14;
const corners = [
  [b.left - m, b.top - m],
  [b.right + m, b.top - m],
  [b.right + m, b.bottom + m],
  [b.left - m, b.bottom + m],
  [b.left - m, b.top - m],
];
await page.mouse.move(...corners[0]);
await page.mouse.down();
for (const corner of corners.slice(1)) await page.mouse.move(...corner, { steps: 40 });
// Release over the button itself: no click may reach it.
await page.mouse.move((b.left + b.right) / 2, (b.top + b.bottom) / 2, { steps: 5 });
await page.mouse.up();
check('stroke is saved once, on pointer up', await waitForFile((c) => c.strokes.length === 1));
const saved = read().strokes[0];
check(
  'saved stroke is simplified (few points for ~170 samples)',
  saved.points.length > 4 && saved.points.length < 60,
  saved.points.length,
);
check('saved stroke uses the default pen (red, 4px)', saved.width === 4 && /^#/i.test(saved.color), saved);
check('no click reached the story', (await previewFrame(page).evaluate(() => window.__clicks)) === 0);
const after = await boardState(page);
check('no frame was selected', after.selectedId === null, after.selectedId);
check('no frame was raised', after.frames.map((f) => f.id).join(' ') === framesBefore);
check('the board did not pan', JSON.stringify(after.view) === JSON.stringify(viewBefore), after.view);
// World coordinates: the stroke surrounds the button's frame-relative position at zoom 1.
const frame = after.frames.find((f) => f.id === 'frame_btn');
const xs = saved.points.map(([x]) => x);
check('stroke is stored in world coordinates', Math.min(...xs) < frame.x + 20 && Math.min(...xs) > frame.x - 40, {
  min: Math.min(...xs),
  frame,
});
await checkAligned(page, 'zoom 1');

// 3. Zoom to 50% and 200% with the toolbar, pan with the wheel (two-finger scroll) in draw mode.
const zoomOut = previewFrame(page).locator('button[aria-label="Zoom out"]');
const zoomIn = previewFrame(page).locator('button[aria-label="Zoom in"]');
for (let i = 0; i < 3; i++) await zoomOut.click();
check('zoomed to 50%', (await boardState(page)).view.zoom === 0.5, (await boardState(page)).view);
await checkAligned(page, 'zoom 0.5');
for (let i = 0; i < 7; i++) await zoomIn.click();
check('zoomed to 200%', (await boardState(page)).view.zoom === 2, (await boardState(page)).view);
// Bring the button into view with a plain wheel (trackpad scroll) over the mode layer.
{
  await settle(page);
  const { iframe } = await boardState(page);
  await page.mouse.move(iframe.x + iframe.width / 2, iframe.y + iframe.height / 2);
  const before = (await boardState(page)).view;
  for (let i = 0; i < 6; i++) {
    const button = await buttonRect(page);
    const dx = button.left - (iframe.x + 300);
    const dy = button.top - (iframe.y + 250);
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) break;
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(150);
    await settle(page);
  }
  const moved = (await boardState(page)).view;
  check('wheel pans in draw mode', moved.x !== before.x || moved.y !== before.y, { before, moved });
}
await checkAligned(page, 'zoom 2');
// Pinch (ctrl+wheel) zooms in draw mode.
{
  const before = (await boardState(page)).view.zoom;
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 40);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const zoom = (await boardState(page)).view.zoom;
  check('pinch zooms in draw mode', zoom < before, { before, zoom });
  await checkAligned(page, `zoom ${zoom.toFixed(2)} after pinch`);
}

// 4. Hostile story CSS (all stories share this page) does not move or hide the strokes.
await previewFrame(page).evaluate(() => {
  const style = document.createElement('style');
  style.id = 'hostile';
  style.textContent =
    'canvas { width: 50px; height: 50px; position: static; margin: 20px; opacity: 0.2; border: 3px solid red; transform: scale(0.5) } * { box-sizing: content-box }';
  document.head.append(style);
});
await page.waitForTimeout(200);
await checkAligned(page, 'with hostile story CSS');
await previewFrame(page).evaluate(() => document.getElementById('hostile').remove());

// 5. Reload: the stroke and the view come back aligned.
await page.waitForTimeout(400); // the view is stored 250 ms after it settles
await page.reload();
await waitForBoard(page, 3);
await checkAligned(page, 'after reload');
check('mode is select after reload', (await mode(page)) === 'select');

// 6. Eraser: a swipe across the stroke erases it whole; ⌘Z puts it back with the same id; ⇧⌘Z erases again.
await previewFrame(page).locator('button[data-colab-mode="draw"]').click();
await previewFrame(page).locator('[data-colab-draw-tool="eraser"]').click();
{
  const ink = await inkBounds(page);
  const y = ink.top + 1;
  await page.mouse.move(ink.left + 10, y - 20);
  await page.mouse.down();
  await page.mouse.move(ink.left + 20, y + 20, { steps: 10 });
  await page.mouse.up();
}
check('eraser removes the whole stroke', await waitForFile((c) => c.strokes.length === 0));
check('erased stroke is gone from the layer', (await inkBounds(page)) === null);
await previewFrame(page).locator('[data-colab-board]').focus();
await page.keyboard.press(`${MOD}+z`);
check(
  '⌘Z puts the erased stroke back with the same id',
  await waitForFile((c) => c.strokes.length === 1 && c.strokes[0].id === saved.id),
);
await page.waitForTimeout(200);
await checkAligned(page, 'after undoing the erase');
await page.keyboard.press(`${MOD}+Shift+z`);
check('⇧⌘Z erases it again', await waitForFile((c) => c.strokes.length === 0));
// The stack takes the next key once the redo has finished (its notice shows).
await previewFrame(page).locator('[data-colab-board-notice]', { hasText: 'Redid' }).waitFor();
await page.keyboard.press(`${MOD}+z`);
check('⌘Z brings it back again', await waitForFile((c) => c.strokes.length === 1 && c.strokes[0].id === saved.id), {
  file: read().strokes.map((s) => s.id),
  state: await boardState(page),
  notice: await previewFrame(page)
    .locator('[data-colab-board-notice]')
    .textContent()
    .catch(() => null),
  active: await previewFrame(page).evaluate(() => document.activeElement?.outerHTML.slice(0, 120)),
});

// 7. Pen: colour, width; undo and redo of a drawn stroke keep its id.
const blue = previewFrame(page).getByRole('switch', { name: 'Blue pen' });
const blueValue = await blue.getAttribute('data-colab-draw-color');
await blue.click();
await previewFrame(page).locator('[data-colab-draw-width="8"]').click();
{
  const { iframe } = await boardState(page);
  await page.mouse.move(iframe.x + 700, iframe.y + 500);
  await page.mouse.down();
  await page.mouse.move(iframe.x + 900, iframe.y + 560, { steps: 20 });
  await page.mouse.up();
}
check(
  'second stroke saved with the chosen colour and width',
  await waitForFile((c) => c.strokes.length === 2 && c.strokes[1].width === 8 && c.strokes[1].color === blueValue),
  read().strokes.at(-1),
);
const second = read().strokes[1];
await page.keyboard.press(`${MOD}+z`);
check('⌘Z removes the drawn stroke', await waitForFile((c) => c.strokes.length === 1 && c.strokes[0].id === saved.id));
await previewFrame(page).locator('[data-colab-board-notice]', { hasText: 'Undid: Draw' }).waitFor();
await page.keyboard.press(`${MOD}+Shift+z`);
check(
  '⇧⌘Z restores it with the same id',
  await waitForFile((c) => c.strokes.length === 2 && c.strokes[1].id === second.id),
);

// 8. Clear all: Cancel keeps everything; Clear empties the file; the notice's Undo restores both in order.
await previewFrame(page).locator('[data-colab-draw-clear]').click();
const dialog = previewFrame(page).locator('[data-colab-clear-dialog]');
await dialog.waitFor();
check(
  'clear asks first',
  /Clear the drawing\?/.test(await dialog.textContent()) && /All 2 strokes/.test(await dialog.textContent()),
  await dialog.textContent(),
);
check(
  'Cancel has focus in the dialog',
  await previewFrame(page).evaluate(() => document.activeElement?.textContent === 'Cancel'),
);
await previewFrame(page).getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(300);
check('Cancel keeps the strokes', read().strokes.length === 2);
await previewFrame(page).locator('[data-colab-draw-clear]').click();
await previewFrame(page).locator('[data-colab-clear-confirm]').click();
check('Clear drawing removes every stroke', await waitForFile((c) => c.strokes.length === 0));
const notice = previewFrame(page).locator('[data-colab-board-notice]', { hasText: 'Cleared' });
await notice.waitFor();
check(
  'a notice offers Undo for the clear',
  /Cleared 2 strokes/.test(await notice.textContent()),
  await notice.textContent(),
);
await notice.locator('button').click();
check(
  'Undo puts both strokes back in order',
  await waitForFile((c) => c.strokes.map((s) => s.id).join() === [saved.id, second.id].join()),
);

// 9. A stroke written by someone else (a hand edit of the file) shows without a reload.
{
  // A short green line through the middle of the board as it is shown now.
  const { view, iframe } = await boardState(page);
  const cx = (iframe.width / 2 - view.x) / view.zoom;
  const cy = (iframe.height / 2 - view.y) / view.zoom;
  const canvas = read();
  canvas.strokes.push({
    id: 'stroke_remote',
    color: '#66BF3C',
    width: 6,
    points: [
      [cx - 50, cy],
      [cx + 50, cy],
    ],
  });
  writeFileSync(CANVAS_FILE, JSON.stringify(canvas, null, 2) + '\n');
  await page.waitForTimeout(1000);
  const has = (await boardState(page)).view.zoom === view.zoom;
  const pixel = await previewFrame(page).evaluate(
    ({ x, y }) => {
      const layer = document.querySelector('[data-colab-stroke-layer="saved"]');
      const dpr = layer.width / layer.getBoundingClientRect().width;
      return [...layer.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data];
    },
    { x: iframe.width / 2, y: iframe.height / 2 },
  );
  check('remote stroke appears live', has && pixel[3] > 200 && pixel[1] > pixel[0], pixel);
}

// 10. Escape leaves draw mode; the story is interactive again.
await page.keyboard.press('Escape');
check('Escape returns to select mode', (await mode(page)) === 'select');
check(
  'drawing options hide outside draw mode',
  (await previewFrame(page).locator('[data-colab-draw-options]').count()) === 0,
);

check('no page errors', errors.length === 0, errors);
await browser.close();

// 11. DPR 1: the same stroke lines up on a 1x screen.
{
  writeFileSync(CANVAS_FILE, JSON.stringify({ ...read(), strokes: [saved] }, null, 2) + '\n');
  await new Promise((resolve) => setTimeout(resolve, 600));
  const session = await openBoard({ dpr: 1 });
  const ink = await inkBounds(session.page);
  check(
    'DPR 1: layer backing is 1 device pixel per CSS pixel',
    ink && ink.backing.width === Math.round(ink.backing.cssWidth),
    ink?.backing,
  );
  await checkAligned(session.page, 'DPR 1');
  await session.browser.close();
}

writeFileSync(CANVAS_FILE, JSON.stringify(BASE_CANVAS, null, 2) + '\n');
done();
