// Pan and zoom input on the board: wheel pans, ctrl+wheel zooms around the pointer, dragging empty
// space pans, Space+drag pans over a story without clicking it, toolbar buttons zoom, and the view
// survives a reload. Run: SB=http://127.0.0.1:6160 node scripts/check-board-view.mjs
import { SB, resetCanvas, boardState, check, done, launch, modelPoint, previewFrame, setView, waitForBoard } from './board-lib.mjs';

// DPR 1: at DPR 2, CDP-synthesised wheel events arrive with half the requested delta.
await resetCanvas();
const { browser, page, errors } = await launch({ dpr: 1 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 40, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;

let s = await boardState(page);
// Empty space between the Button frame (68px tall) and the Page frame (y 200), in world coordinates.
const emptyAt = (st) => ({ x: st.iframe.x + st.view.x + 180 * st.view.zoom, y: st.iframe.y + st.view.y + 140 * st.view.zoom });
let empty = emptyAt(s);
await page.mouse.move(empty.x, empty.y);
await page.mouse.wheel(30, 50);
await page.waitForTimeout(200);
let t = await boardState(page);
check('wheel pans', near(t.view.x, s.view.x - 30) && near(t.view.y, s.view.y - 50) && t.view.zoom === 1, t.view);

// ctrl+wheel (pinch) zooms with the world point under the pointer fixed.
s = t;
const anchor = { x: s.iframe.x + 300, y: s.iframe.y + 200 };
const worldBefore = { x: (300 - s.view.x) / s.view.zoom, y: (200 - s.view.y) / s.view.zoom };
await page.mouse.move(anchor.x, anchor.y);
await page.keyboard.down('Control');
await page.mouse.wheel(0, -40);
await page.keyboard.up('Control');
await page.waitForTimeout(200);
t = await boardState(page);
const worldAfter = { x: (300 - t.view.x) / t.view.zoom, y: (200 - t.view.y) / t.view.zoom };
check('ctrl+wheel zooms in', t.view.zoom > 1.2, t.view);
check('zoom keeps the point under the pointer', near(worldAfter.x, worldBefore.x, 0.01) && near(worldAfter.y, worldBefore.y, 0.01), { worldBefore, worldAfter });

// Drag on empty space pans.
s = t;
empty = emptyAt(s);
await page.mouse.move(empty.x, empty.y);
await page.mouse.down();
await page.mouse.move(empty.x - 100, empty.y + 80, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
t = await boardState(page);
check('dragging empty space pans', near(t.view.x, s.view.x - 100) && near(t.view.y, s.view.y + 80), t.view);

// Space+drag starting on a story pans and does not click it.
await setView(page, 'board', { x: 60, y: 40, zoom: 1 });
await page.reload();
await waitForBoard(page, 3);
s = await boardState(page);
const login = await modelPoint(page, 'frame_page', 'header button:nth-of-type(1)');
// Focus the preview (as a user's click would), then hold Space over the Log in button.
const quiet = emptyAt(s);
await page.mouse.click(quiet.x, quiet.y);
await page.mouse.move(login.x, login.y);
await page.keyboard.down('Space');
await page.mouse.down();
await page.mouse.move(login.x + 40, login.y + 40, { steps: 4 });
await page.mouse.up();
await page.keyboard.up('Space');
await page.waitForTimeout(200);
t = await boardState(page);
const text = await previewFrame(page).evaluate(() => document.querySelector('[data-colab-frame="frame_page"]').textContent);
check('space+drag over a story pans', near(t.view.x, s.view.x + 40) && near(t.view.y, s.view.y + 40), t.view);
check('space+drag does not click the story', !text.includes('Welcome'));

// Toolbar.
const zoomIn = previewFrame(page).getByRole('button', { name: 'Zoom in' });
await zoomIn.click();
t = await boardState(page);
check('toolbar zoom in steps to 110%', near(t.view.zoom, 1.1, 1e-6), t.view);
await previewFrame(page).getByRole('button', { name: /Zoom 110%/ }).click();
t = await boardState(page);
check('percentage button resets to 100%', t.view.zoom === 1, t.view);
await previewFrame(page).getByRole('button', { name: 'Zoom out' }).click();
await previewFrame(page).getByRole('button', { name: 'Zoom out' }).click();
t = await boardState(page);
check('toolbar zoom out twice reaches 75%', near(t.view.zoom, 0.75, 1e-6), t.view);
await previewFrame(page).getByRole('button', { name: 'Zoom to fit all stories' }).click();
t = await boardState(page);
check('zoom to fit changes the view', t.view.zoom > 0 && t.view.zoom <= 1, t.view);

await page.waitForTimeout(400);
await page.reload();
await waitForBoard(page, 3);
const reloaded = await boardState(page);
check('view survives reload', JSON.stringify(reloaded.view) === JSON.stringify(t.view), { before: t.view, after: reloaded.view });
check('no page errors', errors.length === 0, errors);
await browser.close();
done();
