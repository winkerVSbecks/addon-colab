// One zoom control on canvas pages (task 6a): Storybook's toolbar zoom is hidden there, its level is
// reset so the preview is never left scaled, and it is back on story pages.
// Run: SB=http://127.0.0.1:6170 CANVAS_DIR=.sb-6a/canvases node scripts/check-board-zoom.mjs
import { SB, check, done, launch, previewFrame, resetCanvas, waitForBoard } from './board-lib.mjs';

await resetCanvas();
const { browser, page, errors } = await launch({ dpr: 1 });

const toolbar = page.locator('[data-testid="sb-preview-toolbar"]');
const storybookZoom = () => toolbar.locator('button[aria-label*="oom" i]').count();
const iframeScale = () =>
  page.evaluate(() => {
    const iframe = document.querySelector('#storybook-preview-iframe');
    const rect = iframe.getBoundingClientRect();
    return Math.round((rect.width / iframe.offsetWidth) * 100) / 100;
  });

// A story page: Storybook's zoom is there; zoom in so the preview is scaled.
await page.goto(`${SB}/?path=/story/example-button--primary`);
await toolbar.waitFor();
await page.waitForFunction(() => document.querySelector('#storybook-preview-iframe')?.contentDocument?.querySelector('#storybook-root button'));
check("story page shows Storybook's zoom", (await storybookZoom()) > 0, await storybookZoom());
await page.keyboard.press('Alt+Equal');
await page.waitForTimeout(300);
const zoomed = await iframeScale();
check('story preview is zoomed in by Storybook', zoomed > 1, zoomed);

// Open the canvas from the sidebar (client-side navigation keeps the manager's zoom level).
await page.locator('[data-item-id="canvases"]').click();
await page.locator('[data-item-id="colab-canvas-board--canvas"]').click();
await waitForBoard(page, 3);
// The tool goes once the manager has the canvas entry's parameters (a moment after it renders).
await page
  .waitForFunction(() => !document.querySelector('[data-testid="sb-preview-toolbar"] button[aria-label*="oom" i]'), null, { timeout: 5000 })
  .catch(() => undefined);
check("canvas page hides Storybook's zoom", (await storybookZoom()) === 0, await toolbar.locator('button').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label'))));
check('canvas preview is not scaled by Storybook', (await iframeScale()) === 1, await iframeScale());
const boardZoom = await previewFrame(page).locator('[data-colab-board] button[aria-label*="oom" i]').count();
check("the board's own zoom control is there", boardZoom >= 2, boardZoom);
check('the Canvases toolbar menu is still there', (await toolbar.locator('button[aria-label="Canvases"]').count()) === 1);

// Back on a story: Storybook's zoom returns.
await page.locator('[data-item-id="example-button--primary"]').click();
await page.waitForTimeout(800);
check("story page shows Storybook's zoom again", (await storybookZoom()) > 0);

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
