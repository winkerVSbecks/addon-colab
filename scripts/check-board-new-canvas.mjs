// Creating a canvas from the toolbar (Canvases → New canvas…) opens its board, never Storybook's
// error page, and needs no reload.
//
// The bug: the manager opened a new canvas as soon as its own index listed it, while the preview
// learns about the new file from a separate Vite hot update of its map of story files (the builder's
// stories module). When that update came late or not at all, Storybook showed "importers[path] is not
// a function" until the page was reloaded. Now the manager first asks the preview whether it can load
// the entry (src/entry-ready.ts, answered by src/canvas-page/entry-ready.ts, which refreshes a stale
// map), and the preview recovers by itself if the error page shows anyway.
//
// 1. $CREATIONS (default 20) creations as they happen. The race is timing-dependent and rarely shows
//    on a fast machine, so this phase alone does not prove the fix.
// 2. $HELD (default 5) creations with Vite's update of the stories module dropped in the preview: the
//    stale map, every time. The code before the fix failed all of these (error page, no recovery).
// 3. $UNANSWERED (default 2) creations with the update dropped and the manager's question to the
//    preview dropped too: the manager opens the canvas after its timeout, Storybook shows its error
//    page, and the preview must bring the board back by itself.
//
// Works against any Storybook on $SB that has the addon (from src/ or from the built package):
// `pnpm check:browser new-canvas`, or
// `CANVAS_DIR=<its canvas dir> SB=http://127.0.0.1:6196 node scripts/check-board-new-canvas.mjs`.
import { SB, check, done, launch, previewFrame } from './board-lib.mjs';

const CREATIONS = Number(process.env.CREATIONS ?? 20);
/** Creations made while Vite's update of the preview's map of story files is held back. */
const HELD = Number(process.env.HELD ?? 5);
/** Creations made with the update held back and the manager's question to the preview dropped. */
const UNANSWERED = Number(process.env.UNANSWERED ?? 2);
/** How long the board of a new canvas may take to appear. */
const OPEN_WITHIN = 20_000;

/**
 * In the preview iframe, before any of its scripts: records Storybook's error page and story loads
 * that failed because the map of story files was stale, in sessionStorage so they survive reloads.
 */
function instrument() {
  // The preview iframe. Its first document starts as about:blank, whose window Chrome keeps for
  // iframe.html, so check for "a child frame" rather than for the iframe's path.
  if (window === window.top) return;
  const bump = (key) => sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? 0) + 1));
  // Storybook's error page is a class on <body>; poll, because <body> is replaced as pages load.
  setInterval(() => {
    if (!document.body?.classList.contains('sb-show-errordisplay')) return;
    if (sessionStorage.getItem('new-canvas-check:error-page')) return;
    const text = document.querySelector('#error-message')?.textContent ?? '';
    sessionStorage.setItem('new-canvas-check:error-page', text || 'error page shown');
  }, 25);
  // While `new-canvas-check:hold` is set, drop Vite's hot updates of the stories module, so the
  // preview's map of story files stays as it was before the canvas was created (the stale map).
  const NativeWebSocket = window.WebSocket;
  const addEventListener = NativeWebSocket.prototype.addEventListener;
  NativeWebSocket.prototype.addEventListener = function (type, listener, ...rest) {
    if (type !== 'message' || typeof listener !== 'function')
      return addEventListener.call(this, type, listener, ...rest);
    const filtered = function (event) {
      if (sessionStorage.getItem('new-canvas-check:hold') && typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          if (message?.type === 'update' && Array.isArray(message.updates)) {
            const stories = (update) => `${update.path} ${update.acceptedPath}`.includes('storybook-stories.js');
            const kept = message.updates.filter((update) => !stories(update));
            if (kept.length !== message.updates.length) {
              bump('new-canvas-check:held');
              if (kept.length === 0) return undefined;
              return listener.call(
                this,
                new MessageEvent('message', { data: JSON.stringify({ ...message, updates: kept }) }),
              );
            }
          }
        } catch {
          // not JSON: pass it on
        }
      }
      return listener.call(this, event);
    };
    return addEventListener.call(this, type, filtered, ...rest);
  };
  let preview;
  Object.defineProperty(window, '__STORYBOOK_PREVIEW__', {
    configurable: true,
    get: () => preview,
    set(value) {
      preview = value;
      if (!value || value.__newCanvasCheckWrapped) return;
      value.__newCanvasCheckWrapped = true;
      const loadStory = value.loadStory.bind(value);
      value.loadStory = async (...args) => {
        try {
          return await loadStory(...args);
        } catch (error) {
          if (/importers\[[^\]]*\] is not a function/.test(String(error?.message))) bump('new-canvas-check:stale');
          throw error;
        }
      };
    },
  });
}

const { browser, context, page, errors } = await launch({ dpr: 1, width: 1800 });
await context.addInitScript(instrument);

/** Reads and clears what the preview recorded. */
const recorded = () =>
  previewFrame(page).evaluate(() => {
    const read = (key) => Number(sessionStorage.getItem(key) ?? 0);
    const result = {
      errorPage: sessionStorage.getItem('new-canvas-check:error-page'),
      stale: read('new-canvas-check:stale'),
      held: read('new-canvas-check:held'),
    };
    for (const key of ['error-page', 'stale', 'held']) sessionStorage.removeItem(`new-canvas-check:${key}`);
    return result;
  });
const setHold = (on) =>
  previewFrame(page).evaluate((on) => {
    if (on) sessionStorage.setItem('new-canvas-check:hold', '1');
    else sessionStorage.removeItem('new-canvas-check:hold');
  }, on);

/** The preview right now: the board of `canvasId`, Storybook's error page, or something else. */
const previewState = (canvasId) =>
  page.evaluate((canvasId) => {
    const doc = document.querySelector('#storybook-preview-iframe')?.contentDocument;
    if (!doc?.body) return 'no preview';
    if (doc.body.classList.contains('sb-show-errordisplay')) {
      return `error page: ${doc.querySelector('#error-message')?.textContent ?? ''}`;
    }
    return canvasId && doc.querySelector(`[data-colab-board="${canvasId}"]`) ? 'board' : 'loading';
  }, canvasId);

const run = Date.now().toString(36);

/** Creates one canvas through the toolbar and watches what the preview shows. */
async function createOne(label) {
  const name = `New ${run} ${label}`;
  await page.locator('button[aria-label="Canvases"]').click();
  await page.getByText('New canvas…', { exact: true }).click();
  await page.getByLabel('Canvas name').fill(name);
  const canvasIdIn = (url) => /\/story\/colab-canvas-([^&]*)--canvas/.exec(url)?.[1];
  const before = canvasIdIn(page.url());
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const started = Date.now();

  let canvasId;
  let state = 'loading';
  let errorPage;
  while (Date.now() - started < OPEN_WITHIN) {
    const current = canvasIdIn(page.url());
    canvasId = current !== before ? current : undefined;
    state = await previewState(canvasId);
    if (state.startsWith('error page')) errorPage ??= state;
    if (state === 'board') break;
    await page.waitForTimeout(50);
  }
  const ms = Date.now() - started;
  // Let Storybook settle (a late error page would show up here), then read what the preview saw.
  await page.waitForTimeout(600);
  const after = await previewState(canvasId);
  if (after.startsWith('error page')) errorPage ??= after;
  const seen = await recorded();
  errorPage ??= seen.errorPage ?? undefined;
  const ok = state === 'board' && after === 'board' && !errorPage;
  console.log(
    `  ${label}: ${ok ? 'board' : `NOT OK (${errorPage ?? after})`} after ${ms} ms` +
      `${seen.held ? `, stories-module update held back ×${seen.held}` : ''}` +
      `${seen.stale ? `, a load hit a stale map of story files ×${seen.stale}` : ''}`,
  );
  return { label, ok, ms, canvasId, state: after, errorPage, ...seen };
}

try {
  await page.goto(`${SB}/?path=/story/example-button--primary`);
  await page.waitForSelector('button[aria-label="Canvases"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  await recorded();

  // 1. As it happens: the preview's map usually updates in time; sometimes it did not.
  const natural = [];
  for (let i = 1; i <= CREATIONS; i++) natural.push(await createOne(`creation ${i}`));
  const good = natural.filter((result) => result.ok).length;
  check(
    `every new canvas opens its board with no error page and no reload (${good} of ${CREATIONS})`,
    good === CREATIONS,
    natural.filter((result) => !result.ok),
  );

  // 2. The failing case, made certain: Vite's update of the preview's map never arrives.
  await setHold(true);
  const held = [];
  for (let i = 1; i <= HELD; i++) held.push(await createOne(`held ${i}`));
  await setHold(false);
  const heldGood = held.filter((result) => result.ok).length;
  check(
    `… also when the preview's map of story files is not updated (${heldGood} of ${HELD})`,
    heldGood === HELD,
    held.filter((result) => !result.ok),
  );
  check(
    '… (the update was really held back each time)',
    held.every((result) => result.held > 0),
    held.map((result) => result.held),
  );

  // 3. The safety net: the map is not updated AND the manager gets no answer from the preview (its
  //    request is dropped), so it opens the canvas after its timeout, Storybook shows its error page,
  //    and the preview must bring the board back by itself, without a reload.
  await page.evaluate(() => {
    const channel = window.__STORYBOOK_ADDONS_CHANNEL__;
    const emit = channel.emit.bind(channel);
    channel.emit = (event, ...args) => (event === 'addon-colab/entry-ready-request' ? undefined : emit(event, ...args));
  });
  await setHold(true);
  const unanswered = [];
  for (let i = 1; i <= UNANSWERED; i++) unanswered.push(await createOne(`no answer ${i}`));
  await setHold(false);
  const recovered = unanswered.filter((result) => result.state === 'board').length;
  check(
    `with no answer from the preview, the canvas still opens and its board comes back by itself (${recovered} of ${UNANSWERED})`,
    recovered === UNANSWERED,
    unanswered.filter((result) => result.state !== 'board'),
  );
  check(
    '… (Storybook did show its error page first, so the safety net was tested)',
    unanswered.every((result) => result.errorPage),
    unanswered.map((result) => result.errorPage ?? null),
  );

  // Expected noise: Storybook's own log of a stale map, and loads made while the map is stale.
  const serious = errors.filter(
    (e) => !/importers\[path\]|Failed to fetch dynamically imported module|Outdated Optimize Dep/i.test(e),
  );
  check('no unexpected page errors', serious.length === 0, serious);
} finally {
  await browser.close();
}
done();
