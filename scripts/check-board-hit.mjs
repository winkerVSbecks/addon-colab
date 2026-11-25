// Clicking a button inside a story on the board triggers the story's own behaviour at zoom 0.5, 1
// and 2 (panned), at DPR 1 and 2; overlapping frames hit-test the top one. Needs the canvas
// `board` with frame_page (Page, logged out). Run: SB=http://127.0.0.1:6160 node scripts/check-board-hit.mjs
import { SB, resetCanvas, boardState, check, done, launch, modelPoint, previewFrame, setView, waitForBoard } from './board-lib.mjs';

const URL = `${SB}/?path=/story/colab-canvas-board--canvas`;

await resetCanvas();
for (const dpr of [1, 2]) {
  const { browser, page, errors } = await launch({ dpr });
  await page.goto(`${SB}/`);
  for (const view of [
    { x: 60, y: 40, zoom: 1 },
    { x: 220, y: -30, zoom: 0.5 },
    { x: -1160, y: -160, zoom: 2 },
  ]) {
    await setView(page, 'board', view);
    await page.goto(URL);
    await page.reload();
    await waitForBoard(page, 3);
    const state = await boardState(page);
    check(`DPR ${dpr} zoom ${view.zoom}: stored view restored`, JSON.stringify(state.view) === JSON.stringify(view), state.view);
    const login = await modelPoint(page, 'frame_page', 'header button:nth-of-type(1)');
    const hit = await previewFrame(page).evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { tag: el?.tagName, text: el?.textContent?.trim(), frame: el?.closest('[data-colab-frame]')?.dataset.colabFrame };
    }, { x: login.x - state.iframe.x, y: login.y - state.iframe.y });
    check(`DPR ${dpr} zoom ${view.zoom}: elementFromPoint hits Page's Log in`, hit.frame === 'frame_page' && hit.text === 'Log in', hit);
    await page.mouse.click(login.x, login.y);
    await page.waitForTimeout(300);
    const text = await previewFrame(page).evaluate(() => document.querySelector('[data-colab-frame="frame_page"]').textContent);
    check(`DPR ${dpr} zoom ${view.zoom}: click logs in (story state changed)`, text.includes('Welcome'), text.slice(0, 80));
    const logout = await modelPoint(page, 'frame_page', 'header button:nth-of-type(1)');
    await page.mouse.click(logout.x, logout.y);
    await page.waitForTimeout(300);
    const after = await previewFrame(page).evaluate(() => document.querySelector('[data-colab-frame="frame_page"]').textContent);
    check(`DPR ${dpr} zoom ${view.zoom}: click logs out again`, !after.includes('Welcome'), after.slice(0, 80));
  }
  check(`DPR ${dpr}: no page errors`, errors.length === 0, errors);
  await browser.close();
}
done();
