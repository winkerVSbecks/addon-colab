// The comment UI and board toolbar stay usable under a hostile story rule (task 7a):
// `* { margin: 12px; padding: 8px; font: 20px/2 serif }` must not push the thread's Delete and
// Close buttons out of view, hide pin icons, or balloon the list and the board toolbar.
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6177 CANVAS_DIR=<its canvas dir> node scripts/check-board-comments-hostile.mjs
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

const comments = [0, 1, 2].map((i) => ({
  id: `comment-hostile${i}`,
  author: i === 1 ? 'agent' : 'user',
  body: `A comment about spacing number ${i + 1}`,
  status: 'open',
  anchor: { type: 'position', x: 100 + i * 120, y: 520 },
  createdAt: new Date(Date.UTC(2026, 10, 25, 12, 0, i)).toISOString(),
  replies:
    i === 0
      ? [{ id: 'reply-hostile0', author: 'agent', body: 'Fixed the gap.', createdAt: '2026-11-25T12:05:00.000Z' }]
      : [],
}));
writeFileSync(CANVAS_FILE, JSON.stringify({ ...BASE_CANVAS, comments }, null, 2) + '\n');
await new Promise((resolve) => setTimeout(resolve, 600));

const { browser, page, errors } = await launch({
  dpr: 2,
  width: 1600,
  height: 960,
  colorScheme: process.env.SCHEME ?? 'light',
});
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 40, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const pv = previewFrame(page);
await pv.locator('[data-colab-comments-toggle]').click();
await pv.locator('[data-colab-pin="comment-hostile0"]').click();
await pv.locator('[data-colab-thread="comment-hostile0"]').waitFor();
await page.waitForTimeout(300);

const measure = () =>
  pv.evaluate(() => {
    const rect = (element) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const reachable = (element) => {
      if (!element) return false;
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && element.contains(hit);
    };
    const thread = document.querySelector('[data-colab-thread="comment-hostile0"]');
    const threadRect = thread.getBoundingClientRect();
    const inThread = (element) => {
      const r = element.getBoundingClientRect();
      return r.left >= threadRect.left - 1 && r.right <= threadRect.right + 1 && r.top >= threadRect.top - 1;
    };
    const buttons = ['Resolve comment', 'Delete comment', 'Close comment'].map((label) =>
      thread.querySelector(`button[aria-label="${label}"]`),
    );
    const pin = document.querySelector('[data-colab-pin="comment-hostile1"]');
    const icon = pin.querySelector('svg');
    const iconRect = icon.getBoundingClientRect();
    const pinRect = pin.getBoundingClientRect();
    return {
      threadButtons: buttons.map((b) => !!b && reachable(b) && inThread(b)),
      thread: rect(thread),
      pin: rect(pin),
      icon: rect(icon),
      iconInsidePin:
        iconRect.width >= 10 &&
        iconRect.left >= pinRect.left &&
        iconRect.right <= pinRect.right &&
        iconRect.top >= pinRect.top &&
        iconRect.bottom <= pinRect.bottom,
      list: rect(document.querySelector('[data-colab-comment-list]')),
      item: rect(document.querySelector('[data-colab-list-item]')),
      header: rect(document.querySelector('[data-colab-comment-list] h2')?.parentElement),
      toolbar: rect(document.querySelector('[data-colab-board-toolbar]')),
      modeButton: rect(document.querySelector('button[data-colab-mode="select"]')),
    };
  });

const clean = await measure();
await pv.evaluate(() => {
  const style = document.createElement('style');
  style.id = 'hostile';
  style.textContent = '* { margin: 12px; padding: 8px; font: 20px/2 serif; } button { letter-spacing: 2px; }';
  document.head.append(style);
});
await page.waitForTimeout(300);
const hostile = await measure();
await page.screenshot({
  path: `${process.env.OUT ?? process.env.TMPDIR ?? '/tmp'}/comments-hostile-${process.env.SCHEME ?? 'light'}.png`,
});

check(
  'clean: the thread buttons are in the thread and clickable',
  clean.threadButtons.every(Boolean),
  clean.threadButtons,
);
check(
  'hostile: Resolve, Delete and Close stay in the thread and clickable',
  hostile.threadButtons.every(Boolean),
  hostile,
);
check('hostile: pin icons stay visible inside the pin', hostile.iconInsidePin, {
  pin: hostile.pin,
  icon: hostile.icon,
});
check('hostile: the pin keeps its size', hostile.pin.w === clean.pin.w && hostile.pin.h === clean.pin.h, {
  clean: clean.pin,
  hostile: hostile.pin,
});
const grew = (key, axis, slack) => hostile[key][axis] - clean[key][axis] > slack;
check('hostile: the list keeps its width', !grew('list', 'w', 1), { clean: clean.list, hostile: hostile.list });
check('hostile: list rows do not balloon', !grew('item', 'h', 8), { clean: clean.item, hostile: hostile.item });
check('hostile: the list header does not balloon', !grew('header', 'h', 4), {
  clean: clean.header,
  hostile: hostile.header,
});
check('hostile: the board toolbar does not balloon', !grew('toolbar', 'h', 4) && !grew('toolbar', 'w', 40), {
  clean: clean.toolbar,
  hostile: hostile.toolbar,
});
check('hostile: the thread does not balloon', !grew('thread', 'h', 40), {
  clean: clean.thread,
  hostile: hostile.thread,
});
check('no page errors', errors.length === 0, errors);
await browser.close();
done();
