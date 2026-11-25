// Sidebar drag onto the board (CDP-synthesised native drag and drop, manager → preview iframe):
// - the whole story row is the drag handle, with the project's own renderLabel still in place;
// - the drop lands with the frame's top-left at the pointer at zoom 0.5, 1 and 2 (panned);
// - dragging does not navigate; clicking a row still opens the story; arrow keys + Enter still work;
// - a collapsed component row is not a drag source and still expands on click;
// - a canvas row cannot be dropped onto a canvas.
// Resets .sb-task6/canvases/board.json first. Run: SB=http://127.0.0.1:6160 node scripts/check-board-drag.mjs
import { writeFileSync } from 'node:fs';

import { SB, boardState, check, done, launch, previewFrame, setView, waitForBoard } from './board-lib.mjs';

const CANVAS_FILE = new URL('../.sb-task6/canvases/board.json', import.meta.url);
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
await new Promise((resolve) => setTimeout(resolve, 500));

const BOARD_URL = `${SB}/?path=/story/colab-canvas-board--canvas`;
const { browser, page, errors } = await launch({ dpr: 2 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 40, zoom: 1 });
await page.goto(BOARD_URL);
await waitForBoard(page, 3);

const row = (id) => page.locator(`[role="row"][data-item-id="${id}"]`);

// Collapsed component: not draggable, click expands without navigating.
const component = row('example-button');
check('collapsed component row is not draggable', (await component.getAttribute('draggable')) !== 'true');
await component.click();
await page.waitForTimeout(300);
check('clicking a collapsed component expands it', (await component.getAttribute('aria-expanded')) === 'true');
check('…and stays on the canvas', page.url().includes('colab-canvas-board--canvas'), page.url());

const secondary = row('example-button--secondary');
await secondary.waitFor();
check('project renderLabel is kept', (await page.locator('[data-project-label="example-button--secondary"]').count()) === 1);
check('story row is draggable', (await secondary.getAttribute('draggable')) === 'true');
check('canvas row is not draggable', (await row('colab-canvas-board--canvas').getAttribute('draggable')) !== 'true');

async function expandButton() {
  if ((await row('example-button').getAttribute('aria-expanded')) !== 'true') await row('example-button').click();
  await row('example-button--secondary').waitFor();
}

async function dragRowTo(id, target, { grabAt = 'right' } = {}) {
  await expandButton();
  const box = await row(id).boundingBox();
  // Grab the row right of its label (left of the ⋯ menu button), to show the whole row is the handle.
  const start = { x: grabAt === 'right' ? box.x + box.width - 44 : box.x + 40, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y + 5, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(800);
}

const views = [
  { view: { x: 60, y: 40, zoom: 1 }, world: { x: 500, y: 140 } },
  { view: { x: 300, y: 120, zoom: 0.5 }, world: { x: 1100, y: 300 } },
  { view: { x: -700, y: -200, zoom: 2 }, world: { x: 520, y: 170 } },
];
let frameCount = 3;
for (const { view, world } of views) {
  await setView(page, 'board', view);
  await page.goto(BOARD_URL);
  await waitForBoard(page, frameCount);
  const state = await boardState(page);
  const board = await previewFrame(page).evaluate(() => {
    const r = document.querySelector('[data-colab-board]').getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  const target = {
    x: state.iframe.x + board.x + view.x + world.x * view.zoom,
    y: state.iframe.y + board.y + view.y + world.y * view.zoom,
  };
  await dragRowTo('example-button--secondary', target, { grabAt: view.zoom === 1 ? 'right' : 'label' });
  frameCount += 1;
  const after = await boardState(page);
  const added = after.frames.find((frame) => !state.frames.some((f) => f.id === frame.id));
  check(`zoom ${view.zoom}: drop adds a frame`, !!added && added.storyId === 'example-button--secondary', after.frames);
  check(
    `zoom ${view.zoom}: frame top-left is at the pointer (±1px world)`,
    !!added && Math.abs(added.x - world.x) <= 1 && Math.abs(added.y - world.y) <= 1,
    { expected: world, got: added && { x: added.x, y: added.y } },
  );
  check(`zoom ${view.zoom}: dragging did not navigate`, page.url().includes('colab-canvas-board--canvas'), page.url());
  const rendered = await previewFrame(page).evaluate(
    (id) => document.querySelector(`[data-colab-frame="${id}"]`)?.textContent ?? '',
    added?.id,
  );
  check(`zoom ${view.zoom}: dropped story renders live`, rendered.includes('Button'), rendered);
}

// A canvas cannot go onto a canvas (its row is not draggable; a forged drop is refused).
await previewFrame(page).evaluate(() => {
  const board = document.querySelector('[data-colab-board]');
  const data = new DataTransfer();
  data.setData('application/x-storybook-story', 'colab-canvas-board--canvas');
  const r = board.getBoundingClientRect();
  const init = { dataTransfer: data, bubbles: true, cancelable: true, clientX: r.left + 50, clientY: r.top + 50 };
  board.dispatchEvent(new DragEvent('dragover', init));
  board.dispatchEvent(new DragEvent('drop', init));
});
await page.waitForTimeout(500);
const notice = await previewFrame(page).evaluate(() => document.querySelector('[data-colab-board-notice]')?.textContent ?? '');
check('dropping a canvas shows a message and adds nothing', notice.includes("can't be added") && (await boardState(page)).frames.length === frameCount, notice);

// Clicking a row (on the label and away from it) still navigates.
await expandButton();
await secondary.click({ position: { x: 40, y: 10 } });
await page.waitForURL(/example-button--secondary/, { timeout: 5000 }).catch(() => undefined);
check('clicking a row label opens the story', page.url().includes('example-button--secondary'), page.url());
await page.goto(BOARD_URL);
await waitForBoard(page, frameCount);
await expandButton();
const box = await row('example-button--primary').boundingBox();
await page.mouse.click(box.x + box.width - 44, box.y + box.height / 2);
await page.waitForURL(/example-button--primary/, { timeout: 5000 }).catch(() => undefined);
check('clicking the empty right side of a row opens the story', page.url().includes('example-button--primary'), page.url());

// Keyboard: arrow down from the focused row, then Enter opens the next story.
await row('example-button--primary').focus();
await page.keyboard.press('ArrowDown');
const focused = await page.evaluate(() => document.activeElement?.closest('[role="row"]')?.getAttribute('data-item-id'));
check('arrow down moves focus to the next row', focused === 'example-button--secondary', focused);
await page.keyboard.press('Enter');
await page.waitForURL(/example-button--secondary/, { timeout: 5000 }).catch(() => undefined);
check('Enter opens the focused story', page.url().includes('example-button--secondary'), page.url());

check('no page errors', errors.length === 0, errors);
await browser.close();
writeFileSync(CANVAS_FILE, JSON.stringify(BASE, null, 2) + '\n');
done();
