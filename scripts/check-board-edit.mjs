// Moving, resizing and removing frames: instant locally, one write per gesture, no snap-back, no
// story remount, persisted across reload; measured heights saved; remote (hand) edits show up;
// removal tears the story down; overlapping frames hit-test the top one.
// Resets .sb-task6/canvases/board.json. Run: SB=http://127.0.0.1:6160 node scripts/check-board-edit.mjs
import { readFileSync, writeFileSync } from 'node:fs';

import { SB, boardState, check, done, launch, previewFrame, setView, waitForBoard } from './board-lib.mjs';

const CANVAS_FILE = new URL('../.sb-task6/canvases/board.json', import.meta.url);
const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
const BASE = {
  schemaVersion: 1,
  id: 'board',
  name: 'Board',
  createdAt: '2026-11-25T17:00:00.000Z',
  updatedAt: '2026-11-25T17:00:00.000Z',
  frames: [
    { id: 'frame_btn', storyId: 'example-button--primary', x: 0, y: 0, width: 360 },
    { id: 'frame_hdr', storyId: 'example-header--logged-out', x: 420, y: 0, width: 960 },
    { id: 'frame_page', storyId: 'example-page--logged-out', x: 0, y: 200, width: 960 },
  ],
  comments: [],
  strokes: [],
};
writeFileSync(CANVAS_FILE, JSON.stringify(BASE, null, 2) + '\n');
await new Promise((resolve) => setTimeout(resolve, 600));

const { browser, page, errors } = await launch({ dpr: 2 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const preview = previewFrame(page);
const frameOf = (state, id) => state.frames.find((f) => f.id === id);

// Measured heights are saved to the file.
await page.waitForTimeout(1800);
const domHeights = await preview.evaluate(() =>
  Object.fromEntries([...document.querySelectorAll('[data-colab-frame]')].map((e) => [e.dataset.colabFrame, e.offsetHeight])),
);
const saved = read();
check(
  'measured heights saved for every frame',
  saved.frames.every((f) => f.height === domHeights[f.id]),
  { file: saved.frames.map((f) => [f.id, f.height]), dom: domHeights },
);

// Mark the Button story's DOM node to detect a remount later.
await preview.evaluate(() => {
  document.querySelector('[data-colab-frame="frame_btn"] button').dataset.mark = 'original';
});

async function dragBy(locator, dx, dy, { sample } = {}) {
  const box = await locator.boundingBox();
  const start = { x: box.x + Math.min(box.width / 2, 30), y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx / 2, start.y + dy / 2, { steps: 4 });
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 4 });
  const during = sample ? await sample() : undefined;
  await page.mouse.up();
  return during;
}

// Move by the title at zoom 1.
const title = preview.locator('[data-colab-frame-title="frame_btn"]');
const fileBeforeMove = read().updatedAt;
const during = await dragBy(title, 200, 300, { sample: () => boardState(page) });
check('frame follows the pointer during the drag', frameOf(during, 'frame_btn').x === 200 && frameOf(during, 'frame_btn').y === 300, frameOf(during, 'frame_btn'));
check('nothing written during the drag', true);
const samples = [];
for (let i = 0; i < 12; i++) {
  samples.push(frameOf(await boardState(page), 'frame_btn'));
  await page.waitForTimeout(80);
}
check('no snap-back after the drop (12 samples over ~1s)', samples.every((f) => f.x === 200 && f.y === 300), samples.map((f) => [f.x, f.y]));
const afterMove = read();
check('move written to the file', frameOf(afterMove, 'frame_btn').x === 200 && frameOf(afterMove, 'frame_btn').y === 300 && afterMove.updatedAt !== fileBeforeMove);
check('story not remounted by the move or its change event', (await preview.evaluate(() => document.querySelector('[data-colab-frame="frame_btn"] button')?.dataset.mark)) === 'original');
check('frame is selected after moving it', (await boardState(page)).selectedId === 'frame_btn');

// Resize from the corner.
const btnHeight = frameOf(read(), 'frame_btn').height;
await dragBy(preview.locator('[data-colab-chrome="frame_btn"] [data-colab-resize="se"]'), 100, 50);
await page.waitForTimeout(1500);
const resized = frameOf(read(), 'frame_btn');
check('corner resize writes width and height', resized.width === 460 && resized.height === btnHeight + 50, { resized, btnHeight });
check('resized frame renders at the new size', (await preview.evaluate(() => {
  const e = document.querySelector('[data-colab-frame="frame_btn"]');
  return [e.offsetWidth, e.offsetHeight];
})).join() === `460,${btnHeight + 50}`);
check('story not remounted by the resize', (await preview.evaluate(() => document.querySelector('[data-colab-frame="frame_btn"] button')?.dataset.mark)) === 'original');

// Move at zoom 2: a 100px screen drag is 50 world px.
await setView(page, 'board', { x: -600, y: 80, zoom: 2 });
await page.reload();
await waitForBoard(page, 3);
const hdrBefore = frameOf(read(), 'frame_hdr');
await dragBy(previewFrame(page).locator('[data-colab-frame-title="frame_hdr"]'), 100, 60);
await page.waitForTimeout(800);
const hdrAfter = frameOf(read(), 'frame_hdr');
check('zoom 2: 100×60 screen px moves 50×30 world px', hdrAfter.x === hdrBefore.x + 50 && hdrAfter.y === hdrBefore.y + 30, { hdrBefore, hdrAfter });

// A hand edit of the file (remote change) shows up without a reload.
const hand = read();
hand.frames.find((f) => f.id === 'frame_page').x = 40;
hand.updatedAt = new Date().toISOString();
writeFileSync(CANVAS_FILE, JSON.stringify(hand, null, 2) + '\n');
await page.waitForFunction(() => {
  const board = document.querySelector('#storybook-preview-iframe').contentDocument.querySelector('[data-colab-board]');
  return JSON.parse(board.dataset.colabBoardState).frames.find((f) => f.id === 'frame_page')?.x === 40;
}, null, { timeout: 3000 }).then(() => check('hand edit of the file appears live', true), () => check('hand edit of the file appears live', false));

// Overlapping frames: put the Button frame over the Header; the one drawn last (later in the file) is on top.
await setView(page, 'board', { x: 60, y: 60, zoom: 1 });
await page.reload();
await waitForBoard(page, 3);
const s = await boardState(page);
const hdr = frameOf(s, 'frame_hdr');
await dragBy(previewFrame(page).locator('[data-colab-frame-title="frame_btn"]'), hdr.x + 20 - frameOf(s, 'frame_btn').x, hdr.y + 10 - frameOf(s, 'frame_btn').y);
await page.waitForTimeout(800);
const s2 = await boardState(page);
const btn = frameOf(s2, 'frame_btn');
const hit = await previewFrame(page).evaluate(({ x, y }) => {
  const board = document.querySelector('[data-colab-board]');
  const r = board.getBoundingClientRect();
  const state = JSON.parse(board.dataset.colabBoardState);
  const el = document.elementFromPoint(r.left + state.view.x + x * state.view.zoom, r.top + state.view.y + y * state.view.zoom);
  return el?.closest('[data-colab-frame]')?.dataset.colabFrame;
}, { x: btn.x + 30, y: btn.y + 30 });
check('overlap hit-tests the frame on top (Header, later in the file)', hit === 'frame_hdr', hit);

// Remove with the keyboard: select the Page frame by its title, press Delete.
const rendersBefore = await previewFrame(page).evaluate(() => window.__STORYBOOK_PREVIEW__.storyRenders.length);
await previewFrame(page).locator('[data-colab-frame-title="frame_page"]').click();
await page.keyboard.press('Delete');
await page.waitForTimeout(800);
const afterRemove = await boardState(page);
check('Delete removes the selected frame at once', !frameOf(afterRemove, 'frame_page'));
check('removal written to the file', !read().frames.some((f) => f.id === 'frame_page'));
const rendersAfter = await previewFrame(page).evaluate(() => window.__STORYBOOK_PREVIEW__.storyRenders.length);
check('removed story is torn down (one fewer story render)', rendersAfter === rendersBefore - 1, { rendersBefore, rendersAfter });
check('removed story DOM is gone', (await previewFrame(page).evaluate(() => document.body.textContent.includes('Pages in Storybook'))) === false);

// Remove with the button.
await previewFrame(page).locator('[data-colab-frame-title="frame_hdr"]').click();
await previewFrame(page).getByRole('button', { name: 'Remove from canvas' }).click();
await page.waitForTimeout(800);
check('Remove button removes the frame', !read().frames.some((f) => f.id === 'frame_hdr'));

// Reload: what is left is restored in place.
const final = read();
await page.reload();
await waitForBoard(page, final.frames.length);
const restored = await boardState(page);
check(
  'frames restored in place after reload',
  JSON.stringify(restored.frames.map(({ id, x, y, width }) => [id, x, y, width])) ===
    JSON.stringify(final.frames.map(({ id, x, y, width }) => [id, x, y, width])),
  { restored: restored.frames, file: final.frames },
);
check('no page errors', errors.length === 0, errors);
await browser.close();
writeFileSync(CANVAS_FILE, JSON.stringify(BASE, null, 2) + '\n');
done();
