// Comments on the board, end to end in the installed Chrome:
// - comment mode from the toolbar; hover highlights the element under the pointer;
// - a click pins a comment to Header's "Log in" without triggering the story, selecting or raising
//   the frame; the stored target names the story file and a selector that matches exactly that
//   button, read back through the MCP endpoint (list_canvas_comments);
// - pins at zoom 0.5, 1 and 2; frame and position comments; pins follow a frame move and survive reload;
// - agent comments over MCP appear within 2 s: frame anchors with and without x/y, a negative
//   position, three on the same anchor (stacked), one on a removed frame (list only), a detached one;
// - thread: reply, resolve, reopen from the list, delete and ⌘Z back; Escape leaves comment mode.
// Resets $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6171 CANVAS_DIR=<its canvas dir> node scripts/check-board-comments.mjs
import { readFileSync } from 'node:fs';

import { CANVAS_FILE, SB, boardState, check, done, launch, modelPoint, previewFrame, resetCanvas, setView, waitForBoard } from './board-lib.mjs';

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function mcp(name, args) {
  const response = await fetch(`${SB}/colab/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const json = await response.json();
  if (json.error || json.result?.isError) throw new Error(JSON.stringify(json));
  return JSON.parse(json.result.content[0].text);
}

const idOf = (result) => result.commentId ?? result.comment?.id ?? result.id;
await resetCanvas();
const { browser, page, errors } = await launch({ dpr: 2, width: 1800, height: 1000 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await waitForBoard(page, 3);
const preview = previewFrame(page);
await page.waitForTimeout(1500);
const boardAttr = (name) => preview.evaluate((name) => document.querySelector('[data-colab-board]').getAttribute(name), name);
const order = () => read().frames.map((f) => f.id).join(' ');
const orderBefore = order();

// --- Comment mode -------------------------------------------------------------------------------
check('the toolbar offers Select and Comment', (await preview.locator('[data-colab-mode="comment"]').count()) === 1);
await preview.locator('button[data-colab-mode="comment"]').click();
check('Comment mode is on', (await boardAttr('data-colab-mode')) === 'comment');
check('… and its button is pressed', (await preview.locator('button[data-colab-mode="comment"]').getAttribute('aria-checked')) === 'true');

// Hover highlights the Log in button in the Header story.
const logIn = await modelPoint(page, 'frame_hdr', '.storybook-button--secondary');
await page.mouse.move(logIn.x, logIn.y);
await page.waitForTimeout(150);
const hover = preview.locator('[data-colab-hover]');
check('hovering highlights the element under the pointer', (await hover.count()) === 1 && (await hover.getAttribute('data-colab-hover')) === 'element');
check('… labelled with its role and name', /button “Log in”/.test(await hover.textContent()), await hover.textContent());
const aligned = await preview.evaluate(() => {
  const box = document.querySelector('[data-colab-hover]').getBoundingClientRect();
  const button = [...document.querySelectorAll('[data-colab-frame="frame_hdr"] button')].find((b) => b.textContent === 'Log in');
  const rect = button.getBoundingClientRect();
  return Math.abs(box.left - rect.left) < 1 && Math.abs(box.top - rect.top) < 1 && Math.abs(box.width - rect.width) < 1;
});
check('… and the highlight sits exactly on the button', aligned);

// Click in the Page story's Log in: no story behaviour (the Page story would log in).
const pageLogIn = await modelPoint(page, 'frame_page', '.storybook-button--secondary');
await page.mouse.click(pageLogIn.x, pageLogIn.y);
await page.waitForTimeout(400);
const pageText = await preview.locator('[data-colab-frame="frame_page"]').textContent();
check('a click in comment mode does not trigger the story (Page stays logged out)', !/Welcome/.test(pageText) && /Log in/.test(pageText));
check('… does not select the frame', (await boardState(page)).selectedId === null);
check('… and does not raise it', order() === orderBefore, order());
check('… and opens the composer', (await preview.locator('[data-colab-draft]').count()) === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape in the composer cancels it', (await preview.locator('[data-colab-draft]').count()) === 0);
check('… and keeps comment mode', (await boardAttr('data-colab-mode')) === 'comment');

// Pin a comment on Header's Log in.
await page.mouse.click(logIn.x, logIn.y);
await preview.locator('[data-colab-draft] textarea').waitFor();
await page.waitForTimeout(200);
check('the composer names the target', /button “Log in” in/.test(await preview.locator('[data-colab-draft]').textContent()));
await preview.locator('[data-colab-draft] textarea').fill('Make this button bigger');
await page.keyboard.press(`${mod}+Enter`);
await page.waitForTimeout(800);
const saved = read().comments;
const first = saved[0];
check('⌘Enter saves one comment', saved.length === 1 && first?.body === 'Make this button bigger', saved);
check('… anchored to the element in the Header frame', first?.anchor.type === 'element' && first.anchor.frameId === 'frame_hdr', first?.anchor);
const target = first?.anchor.target ?? {};
check('… naming the story, title and story file', target.storyId === 'example-header--logged-out' && target.title === 'Example/Header' && target.importPath === './src/stories/Header.stories.ts', target);
check('… with a stable selector, role and name', target.selector === 'button.storybook-button--secondary' && target.role === 'button' && target.name === 'Log in', target);
check('… and its HTML and text', /^<button/.test(target.html) && target.text === 'Log in', target);
check('the frame order is still unchanged', order() === orderBefore, order());

// Read it back through MCP and check the selector against the live story.
const listed = await mcp('list_canvas_comments', { canvasId: 'board' });
const viaMcp = listed.comments.find((c) => c.commentId === first?.id);
const mcpSelector = viaMcp?.location?.selector;
check('MCP list_canvas_comments returns the comment with the same selector', mcpSelector === target.selector, viaMcp);
const exact = await preview.evaluate((selector) => {
  const root = document.querySelector('[data-colab-frame="frame_hdr"] [data-colab-story-root]');
  const matches = root.querySelectorAll(selector);
  return matches.length === 1 && matches[0].tagName === 'BUTTON' && matches[0].textContent === 'Log in';
}, mcpSelector ?? '');
check('… which matches exactly the Log in button in the story', exact);

const pin = preview.locator(`[data-colab-pin="${first?.id}"]`);
check('a pin shows for it', (await pin.count()) === 1 && (await pin.getAttribute('data-state')) === 'attached');
const pinBox = async () => previewFrame(page).locator(`[data-colab-pin="${first?.id}"]`).boundingBox();
const buttonBox = async () =>
  previewFrame(page).evaluate(() => {
    const b = [...document.querySelectorAll('[data-colab-frame="frame_hdr"] button')].find((x) => x.textContent === 'Log in');
    const r = b.getBoundingClientRect();
    return { right: r.right, top: r.top };
  });
const nearButton = async () => {
  const p = await pinBox();
  const b = await buttonBox();
  const iframe = await (await page.$('#storybook-preview-iframe')).boundingBox();
  // The pin's bottom-left corner is the button's top-right corner.
  return Math.abs(p.x - iframe.x - b.right) < 2 && Math.abs(p.y + p.height - iframe.y - b.top) < 2;
};
check('… at the button’s top-right corner', await nearButton());

// --- Zoom 0.5 and 2: pin and capture still exact ------------------------------------------------
for (const zoom of [0.5, 2]) {
  await previewFrame(page).evaluate(() => document.querySelector('[data-colab-board]').focus());
  await page.evaluate(
    ({ zoom }) => localStorage.setItem('addon-colab:board-view:board', JSON.stringify({ x: 40, y: 40, zoom })),
    { zoom },
  );
  await page.reload();
  await waitForBoard(page, 3);
  await page.waitForTimeout(600);
  check(`zoom ${zoom}: the pin is still on the button`, (await boardState(page)).view.zoom === zoom && (await nearButton()));
  await previewFrame(page).locator('button[data-colab-mode="comment"]').click();
  const selector = zoom === 0.5 ? 'h1' : '.storybook-button--primary';
  const frameId = zoom === 0.5 ? 'frame_hdr' : 'frame_btn';
  const point = await modelPoint(page, frameId, selector);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(150);
  await page.mouse.click(point.x, point.y);
  await previewFrame(page).locator('[data-colab-draft] textarea').waitFor();
  await page.waitForTimeout(200);
  await previewFrame(page).locator('[data-colab-draft] textarea').fill(`At ${zoom}`);
  await previewFrame(page).locator('[data-colab-submit="comment"]').click();
  await page.waitForTimeout(700);
  const added = read().comments.at(-1);
  const expected = zoom === 0.5 ? 'h1' : 'button.storybook-button--primary';
  check(`zoom ${zoom}: a click pins the element under the pointer (${expected})`, added.anchor.type === 'element' && added.anchor.frameId === frameId && added.anchor.target.selector === expected, added.anchor);
}
const p2 = previewFrame(page);

// --- Frame and position comments (at zoom 2) ---------------------------------------------------
const state2 = await boardState(page);
const btnFrame = state2.frames.find((f) => f.id === 'frame_btn');
const corner = {
  x: state2.iframe.x + state2.view.x + (btnFrame.x + 6) * state2.view.zoom,
  y: state2.iframe.y + state2.view.y + (btnFrame.y + 6) * state2.view.zoom,
};
await page.mouse.click(corner.x, corner.y);
await p2.locator('[data-colab-draft] textarea').fill('Whole story');
await p2.locator('[data-colab-submit="comment"]').click();
await page.waitForTimeout(700);
const frameComment = read().comments.at(-1);
check('a click on a story’s empty area pins a frame comment with its offset', frameComment.anchor.type === 'frame' && frameComment.anchor.frameId === 'frame_btn' && Math.abs(frameComment.anchor.x - 6) <= 1 && Math.abs(frameComment.anchor.y - 6) <= 1, frameComment.anchor);
const empty = { x: state2.iframe.x + state2.view.x + -12 * state2.view.zoom, y: state2.iframe.y + state2.view.y + -8 * state2.view.zoom };
await page.mouse.click(empty.x, empty.y);
await p2.locator('[data-colab-draft] textarea').fill('Empty canvas');
await p2.locator('[data-colab-submit="comment"]').click();
await page.waitForTimeout(700);
const positionComment = read().comments.at(-1);
check('a click on empty canvas pins a position comment at the world point', positionComment.anchor.type === 'position' && Math.abs(positionComment.anchor.x + 12) <= 1 && Math.abs(positionComment.anchor.y + 8) <= 1, positionComment.anchor);
check('no frame was selected or raised by any comment click', (await boardState(page)).selectedId === null && order() === orderBefore, order());

// --- Back to zoom 1; pins follow a frame move and survive reload --------------------------------
await page.evaluate(() => localStorage.setItem('addon-colab:board-view:board', JSON.stringify({ x: 60, y: 60, zoom: 1 })));
await page.reload();
await waitForBoard(page, 3);
await page.waitForTimeout(800);
let pv = previewFrame(page);
const pinAt = async (id) => pv.locator(`[data-colab-pin="${id}"]`).boundingBox();
const before = await pinAt(first.id);
// Move the Header frame by +100, +50 through the board's own drag (title).
const title = pv.locator('[data-colab-frame-title="frame_hdr"]');
const tb = await title.boundingBox();
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.mouse.down();
await page.mouse.move(tb.x + tb.width / 2 + 50, tb.y + tb.height / 2 + 25, { steps: 5 });
await page.mouse.move(tb.x + tb.width / 2 + 100, tb.y + tb.height / 2 + 50, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(900);
const after = await pinAt(first.id);
check('the element pin follows its frame when it moves', Math.abs(after.x - before.x - 100) < 2 && Math.abs(after.y - before.y - 50) < 2, { before, after });
await page.reload();
await waitForBoard(page, 3);
await page.waitForTimeout(900);
pv = previewFrame(page);
const reloaded = await pinAt(first.id);
check('… and is in the same place after reload, still attached', Math.abs(reloaded.x - after.x) < 2 && Math.abs(reloaded.y - after.y) < 2 && (await pv.locator(`[data-colab-pin="${first.id}"]`).getAttribute('data-state')) === 'attached', { after, reloaded });

// --- Agent comments over MCP ---------------------------------------------------------------------
const agentAdds = [
  { label: 'frame anchor without x/y', anchor: { type: 'frame', frameId: 'frame_page' } },
  { label: 'frame anchor with x/y', anchor: { type: 'frame', frameId: 'frame_page', x: 200, y: 40 } },
  { label: 'negative position', anchor: { type: 'position', x: -200, y: -120 } },
];
for (const { label, anchor } of agentAdds) {
  const started = Date.now();
  const result = await mcp('add_canvas_comment', { canvasId: 'board', body: `Agent: ${label}`, anchor });
  const id = idOf(result);
  await pv.locator(`[data-colab-pin="${id}"]`).waitFor({ timeout: 2000 }).catch(() => undefined);
  const shown = (await pv.locator(`[data-colab-pin="${id}"]`).count()) === 1;
  check(`agent comment (${label}) appears within 2 s (${Date.now() - started} ms)`, shown && Date.now() - started < 2000);
  check(`… drawn as an agent pin`, (await pv.locator(`[data-colab-pin="${id}"]`).getAttribute('data-author')) === 'agent');
}
const stackIds = [];
for (let i = 0; i < 3; i += 1) {
  const r = await mcp('add_canvas_comment', { canvasId: 'board', body: `Same place ${i}`, anchor: { type: 'sameAs', commentId: first.id } });
  stackIds.push(idOf(r));
}
await page.waitForTimeout(600);
const stacked = await Promise.all([first.id, ...stackIds].map((id) => pinAt(id)));
const xs = new Set(stacked.map((b) => Math.round(b.x)));
check('several comments on the same anchor fan out (4 distinct pins)', stacked.every(Boolean) && xs.size === 4, stacked);
check('the board did not move or select while agent comments arrived', JSON.stringify((await boardState(page)).view) === JSON.stringify({ x: 60, y: 60, zoom: 1 }) && (await boardState(page)).selectedId === null);

// Detached: an element target whose selector no longer matches (and no role, name or text to search for).
const detachedTarget = { ...target, selector: 'button.gone-after-refactor', text: '', role: undefined, name: undefined };
delete detachedTarget.role;
delete detachedTarget.name;
const detached = await mcp('add_canvas_comment', { canvasId: 'board', body: 'Detached', anchor: { type: 'element', frameId: 'frame_hdr', target: detachedTarget } });
const detachedId = idOf(detached);
await page.waitForTimeout(700);
check('an element that cannot be found falls back to its frame, marked detached', (await pv.locator(`[data-colab-pin="${detachedId}"]`).getAttribute('data-state')) === 'detached');

// Removed frame: the comment has no pin but is in the list.
const orphan = await mcp('add_canvas_comment', { canvasId: 'board', body: 'On a removed frame', anchor: { type: 'frame', frameId: 'frame_btn', x: 10, y: 10 } });
const orphanId = idOf(orphan);
// The MCP tools do not remove frames: remove it on the board.
await pv.locator('[data-colab-frame-title="frame_btn"]').click();
await page.keyboard.press('Delete');
await page.waitForTimeout(900);
check('a comment on a removed frame has no pin', (await pv.locator(`[data-colab-pin="${orphanId}"]`).count()) === 0);
await pv.locator('[data-colab-comments-toggle]').click();
const orphanItem = pv.locator(`[data-colab-list-item="${orphanId}"]`);
check('… but is in the comment list, marked not on canvas', (await orphanItem.count()) === 1 && /Not on canvas/.test(await orphanItem.textContent()));
await orphanItem.click();
check('… and its thread opens from the list', (await pv.locator(`[data-colab-thread="${orphanId}"]`).count()) === 1);
await page.keyboard.press(`${mod}+z`);
await page.waitForTimeout(900);

// --- Thread: reply, resolve, reopen, delete + undo ----------------------------------------------
await pv.locator(`[data-colab-list-item="${first.id}"]`).click();
await page.waitForTimeout(400);
const thread = pv.locator(`[data-colab-thread="${first.id}"]`);
check('clicking a comment in the list opens its thread', (await thread.count()) === 1);
const centred = await pv.evaluate((id) => {
  const pin = document.querySelector(`[data-colab-pin="${id}"]`).getBoundingClientRect();
  const board = document.querySelector('[data-colab-board]').getBoundingClientRect();
  return Math.abs(pin.left - (board.left + board.width / 2)) < 4 && Math.abs(pin.bottom - (board.top + board.height / 2)) < 4;
}, first.id);
check('… and brings its pin to the middle of the board', centred);
await thread.locator('textarea').fill('Also make it blue');
await thread.locator('[data-colab-submit="reply"]').click();
await page.waitForTimeout(700);
check('a reply is saved as the user', read().comments.find((c) => c.id === first.id).replies.at(-1)?.body === 'Also make it blue' && read().comments.find((c) => c.id === first.id).replies.at(-1)?.author === 'user');
await mcp('reply_to_canvas_comment', { canvasId: 'board', commentId: first.id, body: 'Done: now 48px' });
await page.waitForTimeout(700);
check('an agent reply appears in the open thread', /Done: now 48px/.test(await thread.textContent()));
await thread.locator('[data-colab-resolve]').click();
await page.waitForTimeout(700);
check('Resolve marks it resolved in the file', read().comments.find((c) => c.id === first.id).status === 'resolved');
await thread.locator('[data-colab-resolve]').click();
await page.waitForTimeout(700);
check('… and the same button reopens it', read().comments.find((c) => c.id === first.id).status === 'open');
const full = JSON.stringify(read().comments.find((c) => c.id === first.id));
await thread.locator('[data-colab-delete]').click();
await page.waitForTimeout(700);
check('Delete removes it from the file', !read().comments.some((c) => c.id === first.id));
check('… offering Undo in a notice', /Deleted comment/.test(await pv.locator('[data-colab-board-notice]').textContent()));
await pv.evaluate(() => document.querySelector('[data-colab-board]').focus());
await page.keyboard.press(`${mod}+z`);
await page.waitForTimeout(900);
check('⌘Z puts it back with the same id, replies and status', JSON.stringify(read().comments.find((c) => c.id === first.id)) === full);
check('… and its pin returns', (await pv.locator(`[data-colab-pin="${first.id}"]`).count()) === 1);

// --- Escape leaves comment mode ------------------------------------------------------------------
await pv.locator('button[data-colab-mode="comment"]').click();
await pv.evaluate(() => document.querySelector('[data-colab-board]').focus());
await page.keyboard.press('Escape');
check('Escape returns to Select mode', (await pv.evaluate(() => document.querySelector('[data-colab-board]').getAttribute('data-colab-mode'))) === 'select');
await page.keyboard.press('c');
check('C switches to Comment mode from the board', (await pv.evaluate(() => document.querySelector('[data-colab-board]').getAttribute('data-colab-mode'))) === 'comment');
await page.keyboard.press('v');

check('no page errors', errors.length === 0, errors);
await browser.close();
done();
