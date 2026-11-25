// Pins never cover the comment list (task 7a): 52 comments whose pins sit under the open list (and
// 25 in dark mode). Every list row must receive the click meant for it, and a thread opened from
// the list must sit above every pin. Also checked with a story rule that gives every button a high
// z-index. Screenshots go to $OUT (default $TMPDIR).
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6177 CANVAS_DIR=<its canvas dir> node scripts/check-board-comments-list.mjs
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

const OUT = process.env.OUT ?? process.env.TMPDIR ?? '/tmp';
const VIEW = { x: 40, y: 60, zoom: 1 };

for (const [scheme, count] of [
  ['light', 52],
  ['dark', 25],
]) {
  writeFileSync(CANVAS_FILE, JSON.stringify(BASE_CANVAS, null, 2) + '\n');
  await new Promise((resolve) => setTimeout(resolve, 600));
  const { browser, page, errors } = await launch({ dpr: 2, width: 1600, height: 960, colorScheme: scheme });
  await page.goto(`${SB}/`);
  await setView(page, 'board', VIEW);
  await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
  await waitForBoard(page, 3);
  const pv = previewFrame(page);
  const board = await pv.evaluate(() => {
    const rect = document.querySelector('[data-colab-board]').getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });

  // Pins in a grid over the area the list covers (the right 340px of the board).
  const comments = Array.from({ length: count }, (_, i) => {
    const column = i % 6;
    const row = Math.floor(i / 6);
    const screen = { x: board.width - 340 + column * 52, y: 40 + row * 70 };
    return {
      id: `comment-list${String(i).padStart(2, '0')}`,
      author: i % 3 === 0 ? 'agent' : 'user',
      body: `Comment ${i + 1} about the right edge of the board`,
      status: 'open',
      anchor: { type: 'position', x: screen.x - VIEW.x, y: screen.y - VIEW.y },
      createdAt: new Date(Date.UTC(2026, 10, 25, 12, 0, i)).toISOString(),
      replies: [],
    };
  });
  writeFileSync(CANVAS_FILE, JSON.stringify({ ...BASE_CANVAS, comments }, null, 2) + '\n');
  await pv.locator(`[data-colab-pin="${comments.at(-1).id}"]`).waitFor({ timeout: 5000 });

  await pv.locator('[data-colab-comments-toggle]').click();
  await pv.locator('[data-colab-comment-list]').waitFor();

  /** For each visible list row: whether the point at its centre hits the row (not a pin). */
  const rowHits = () =>
    pv.evaluate(() => {
      const list = document.querySelector('[data-colab-comment-list]');
      const listRect = list.getBoundingClientRect();
      return [...list.querySelectorAll('[data-colab-list-item]')]
        .map((item) => ({ item, rect: item.getBoundingClientRect() }))
        .filter(({ rect }) => rect.top >= listRect.top && rect.bottom <= listRect.bottom)
        .map(({ item, rect }) => {
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { id: item.dataset.colabListItem, ok: !!hit && item.contains(hit), hit: hit?.outerHTML.slice(0, 80) };
        });
    });
  const pinsUnderList = await pv.evaluate(() => {
    const list = document.querySelector('[data-colab-comment-list]').getBoundingClientRect();
    return [...document.querySelectorAll('[data-colab-pin]')].filter((pin) => {
      const r = pin.getBoundingClientRect();
      return r.left < list.right && r.right > list.left && r.top < list.bottom && r.bottom > list.top;
    }).length;
  });
  check(`${scheme}: many pins lie under the open list (${pinsUnderList})`, pinsUnderList >= 10, pinsUnderList);
  let hits = await rowHits();
  check(
    `${scheme}: every visible list row gets its own clicks (${hits.length} rows)`,
    hits.length > 3 && hits.every((h) => h.ok),
    hits.filter((h) => !h.ok),
  );

  // A story rule that lifts every button (pins are buttons) must not change that.
  await pv.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'lift-buttons';
    style.textContent = 'button { position: relative; z-index: 9999 !important; } * { z-index: 50; }';
    document.head.append(style);
  });
  await page.waitForTimeout(200);
  hits = await rowHits();
  check(
    `${scheme}: … also with a story rule giving every button z-index 9999`,
    hits.every((h) => h.ok),
    hits.filter((h) => !h.ok),
  );

  // Open a thread from the list (a row in the middle): it is above the pins too.
  const target = hits[Math.floor(hits.length / 2)].id;
  await pv.locator(`[data-colab-list-item="${target}"]`).click();
  await pv.locator(`[data-colab-thread="${target}"]`).waitFor();
  await page.waitForTimeout(400);
  const threadHits = await pv.evaluate((id) => {
    const thread = document.querySelector(`[data-colab-thread="${id}"]`);
    const buttons = [...thread.querySelectorAll('button')];
    return buttons.map((button) => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { label: button.getAttribute('aria-label') ?? button.textContent, ok: !!hit && button.contains(hit) };
    });
  }, target);
  check(
    `${scheme}: the thread opened from the list is above every pin`,
    threadHits.every((h) => h.ok),
    threadHits,
  );
  const overlap = await pv.evaluate((id) => {
    const thread = document.querySelector(`[data-colab-thread="${id}"]`).getBoundingClientRect();
    const list = document.querySelector('[data-colab-comment-list]').getBoundingClientRect();
    return thread.right > list.left && thread.left < list.right;
  }, target);
  check(`${scheme}: the thread does not cover the list`, !overlap);
  await pv.evaluate(() => document.getElementById('lift-buttons')?.remove());
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/comments-list-${scheme}.png` });
  check(`${scheme}: no page errors`, errors.length === 0, errors);
  await browser.close();
}
console.log('screenshots in', OUT);
done();
