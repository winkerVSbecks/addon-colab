// The mode switcher (task 7a): a radio group (one checked radio in the Tab order; arrow keys move
// focus as in any Storybook Toolbar, Space checks), and after a mode is chosen with a click, Space-drag pans at once (focus went back
// to the board) instead of pressing the button again or starting a comment.
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6177 CANVAS_DIR=.sb-7a/canvases node scripts/check-board-modes.mjs
import { SB, boardState, check, done, launch, previewFrame, resetCanvas, setView, waitForBoard } from './board-lib.mjs';

await resetCanvas();
const { browser, page, errors } = await launch({ dpr: 2, width: 1600, height: 960 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 40, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const pv = previewFrame(page);

const radios = () =>
  pv.evaluate(() => {
    const group = document.querySelector('[data-colab-board-toolbar] [role="radiogroup"]');
    return {
      label: group?.getAttribute('aria-label'),
      radios: [...(group?.querySelectorAll('[data-colab-mode]') ?? [])].map((b) => ({
        mode: b.dataset.colabMode,
        role: b.getAttribute('role'),
        checked: b.getAttribute('aria-checked'),
        tabIndex: b.tabIndex,
      })),
      focused: document.activeElement?.dataset?.colabMode ?? document.activeElement?.tagName,
    };
  });
let r = await radios();
check('the mode buttons are a labelled radio group', r.label === 'Board mode' && r.radios.length === 3, r);
check(
  'each mode is a radio; only the checked one is in the Tab order',
  r.radios.every(
    (b) =>
      b.role === 'radio' &&
      (b.checked === 'true') === (b.mode === 'select') &&
      b.tabIndex === (b.mode === 'select' ? 0 : -1),
  ),
  r.radios,
);

// Click Comment: comment mode, focus on the board.
await pv.locator('button[data-colab-mode="comment"]').click();
await page.waitForTimeout(200);
r = await radios();
check('clicking Comment checks it', r.radios.find((b) => b.mode === 'comment')?.checked === 'true', r.radios);
const focusPlace = await pv.evaluate(() =>
  document.activeElement?.hasAttribute('data-colab-board') ? 'board' : document.activeElement?.outerHTML.slice(0, 80),
);
check('… and gives focus back to the board', focusPlace === 'board', focusPlace);

// Space-drag pans right away, and no comment draft opens.
const before = (await boardState(page)).view;
await page.mouse.move(800, 500);
await page.keyboard.down('Space');
await page.mouse.down();
await page.mouse.move(900, 560, { steps: 5 });
await page.mouse.up();
await page.keyboard.up('Space');
await page.waitForTimeout(200);
const after = (await boardState(page)).view;
check(
  'Space-drag pans right after choosing a mode',
  Math.abs(after.x - before.x - 100) < 2 && Math.abs(after.y - before.y - 60) < 2,
  { before, after },
);
check('… without opening a comment draft', (await pv.locator('[data-colab-draft]').count()) === 0);
check('… and still in comment mode', (await radios()).radios.find((b) => b.mode === 'comment')?.checked === 'true');

// Keyboard: the arrow keys move focus across the toolbar (Storybook's Toolbar); Space checks.
await pv.locator('button[data-colab-mode="comment"]').focus();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
r = await radios();
check('ArrowRight moves focus to Draw', r.focused === 'draw', r);
await page.keyboard.press('Space');
await page.waitForTimeout(200);
r = await radios();
check('Space checks Draw', r.radios.find((b) => b.mode === 'draw')?.checked === 'true', r.radios);
check(
  '… and focus is back on the board',
  await pv.evaluate(() => document.activeElement?.hasAttribute('data-colab-board')),
);

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
