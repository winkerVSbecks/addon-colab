// Drafts and thread focus (task 7a):
// - switching mode while the comment draft has text keeps the draft and its text (an empty draft
//   still goes away);
// - opening a thread from the list moves focus into it; Escape closes it and focus returns to the
//   list row; Escape with focus on the list also closes the open thread.
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6177 CANVAS_DIR=.sb-7a/canvases node scripts/check-board-comments-focus.mjs
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

const comments = [0, 1].map((i) => ({
  id: `comment-focus${i}`,
  author: 'user',
  body: `Focus comment ${i + 1}`,
  status: 'open',
  anchor: { type: 'position', x: 200 + i * 80, y: 560 },
  createdAt: new Date(Date.UTC(2026, 10, 25, 12, 0, i)).toISOString(),
  replies: [],
}));
writeFileSync(CANVAS_FILE, JSON.stringify({ ...BASE_CANVAS, comments }, null, 2) + '\n');
await new Promise((resolve) => setTimeout(resolve, 600));

const { browser, page, errors } = await launch({ dpr: 2, width: 1600, height: 960 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 40, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const pv = previewFrame(page);
const iframe = await (await page.$('#storybook-preview-iframe')).boundingBox();
const emptySpot = { x: iframe.x + 900, y: iframe.y + 40 };
const draftBox = pv.locator('[data-colab-draft] textarea');

// A draft with text survives a mode switch.
await pv.locator('button[data-colab-mode="comment"]').click();
await page.mouse.click(emptySpot.x, emptySpot.y);
await draftBox.waitFor();
await draftBox.fill('Keep this text');
await pv.locator('button[data-colab-mode="draw"]').click();
await page.waitForTimeout(300);
check(
  'switching to Draw keeps a draft that has text',
  (await draftBox.count()) === 1 && (await draftBox.inputValue()) === 'Keep this text',
);
await pv.locator('button[data-colab-mode="select"]').click();
await page.waitForTimeout(300);
check(
  '… and so does switching to Select',
  (await draftBox.count()) === 1 && (await draftBox.inputValue()) === 'Keep this text',
);
await pv.locator('[data-colab-draft] button', { hasText: 'Cancel' }).click();
await page.waitForTimeout(200);
check('Cancel still drops it', (await draftBox.count()) === 0);

// An empty draft still goes away with the mode.
await pv.locator('button[data-colab-mode="comment"]').click();
await page.mouse.click(emptySpot.x, emptySpot.y);
await draftBox.waitFor();
await pv.locator('button[data-colab-mode="select"]').click();
await page.waitForTimeout(300);
check('an empty draft is dropped when the mode changes', (await draftBox.count()) === 0);

// Threads from the list.
await pv.locator('[data-colab-comments-toggle]').click();
const row = pv.locator('[data-colab-list-item="comment-focus1"]');
await row.click();
await pv.locator('[data-colab-thread="comment-focus1"]').waitFor();
await page.waitForTimeout(200);
const focusIn = () =>
  pv.evaluate(() => {
    const active = document.activeElement;
    return {
      inThread: !!active?.closest('[data-colab-thread]'),
      listItem: active?.closest('[data-colab-list-item]')?.dataset.colabListItem ?? null,
    };
  });
check('opening a thread from the list moves focus into it', (await focusIn()).inThread, await focusIn());
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape closes it', (await pv.locator('[data-colab-thread]').count()) === 0);
check('… and focus returns to the list row', (await focusIn()).listItem === 'comment-focus1', await focusIn());

await row.click();
await pv.locator('[data-colab-thread="comment-focus1"]').waitFor();
await pv.locator('[data-colab-list-item="comment-focus0"]').focus();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape with focus on the list closes the open thread', (await pv.locator('[data-colab-thread]').count()) === 0);

// A pin click focuses the thread too, and Escape returns focus to the pin.
await pv.locator('[data-colab-pin="comment-focus0"]').click();
await pv.locator('[data-colab-thread="comment-focus0"]').waitFor();
await page.waitForTimeout(200);
check('opening a thread from its pin moves focus into it', (await focusIn()).inThread);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check(
  '… and Escape returns focus to the pin',
  await pv.evaluate(() => document.activeElement?.getAttribute('data-colab-pin') === 'comment-focus0'),
);

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
