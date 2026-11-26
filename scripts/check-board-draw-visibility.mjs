// Strokes stay visible and aligned.
// 1. Contrast: one stroke per colour (width 4, zoom 1) crosses a white story and the empty board,
//    in the light and the dark theme. From real screenshots, it measures the line's core against
//    what is behind it, against its outline, and the outline against what is behind it. A stroke
//    counts as visible when the core reaches 3:1 against the background, or when both the
//    core-to-outline and outline-to-background contrasts reach 3:1 (WCAG 1.4.11, non-text).
// 2. Hostile story CSS: rules with id and :root selectors, !important, individual transforms and
//    animations must not move, resize or hide the board canvas or the stroke layers.
// Resets $CANVAS_DIR/board.json. Run:
//   SB=http://127.0.0.1:6181 CANVAS_DIR=<its canvas dir> node scripts/check-board-draw-visibility.mjs
import { writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import {
  BASE_CANVAS,
  CANVAS_FILE,
  SB,
  boardState,
  check,
  done,
  launch,
  previewFrame,
  resetCanvas,
  setView,
  waitForBoard,
} from './board-lib.mjs';

const COLORS = [
  ['Ink', 'currentColor'],
  ['Red', '#FF4400'],
  ['Amber', '#E69D00'],
  ['Green', '#66BF3C'],
  ['Blue', '#029CFD'],
  ['Purple', '#6F2CAC'],
];
const WIDTH = 4;
const VIEW = { x: 400, y: 60, zoom: 1 };
/** World x of the two sample spots: the empty board left of the frames, and the white Page story. */
const SPOTS = { board: -150, story: 120 };
const rowY = (i) => 300 + i * 40;

const luminance = ([r, g, b]) => {
  const c = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const settle = (page) =>
  previewFrame(page).evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

function writeCanvas(strokes) {
  writeFileSync(CANVAS_FILE, JSON.stringify({ ...BASE_CANVAS, strokes }, null, 2) + '\n');
}

/** Gives the store's watcher time to pick up the hand edit, then waits for the next paint. */
async function waitForStrokes(page) {
  await page.waitForTimeout(1000);
  await settle(page);
}

/** Decodes an 8-bit, non-interlaced RGB(A) PNG screenshot; returns a pixel reader (device pixels). */
function pixels(png) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const body = png.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  return (x, y) => {
    const i = Math.round(y) * stride + Math.round(x) * channels;
    return [out[i], out[i + 1], out[i + 2]];
  };
}

async function openBoard(colorScheme) {
  const session = await launch({ dpr: 2, colorScheme });
  await session.page.goto(`${SB}/`);
  await setView(session.page, 'board', VIEW);
  await session.page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
  await waitForBoard(session.page, 3);
  await session.page.waitForTimeout(1200);
  return session;
}

/** Page CSS px of a world point. */
async function toPage(page, x, y) {
  const { view, iframe } = await boardState(page);
  const board = await previewFrame(page).evaluate(() => {
    const r = document.querySelector('[data-colab-board]').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  return { x: iframe.x + board.left + view.x + x * view.zoom, y: iframe.y + board.top + view.y + y * view.zoom };
}

const results = [];
const screenshots = {};

for (const scheme of ['light', 'dark']) {
  await resetCanvas();
  const { browser, page, errors } = await openBoard(scheme);
  const dpr = 2;
  const before = pixels(await page.screenshot());
  writeCanvas(
    COLORS.map(([, color], i) => ({
      id: `stroke_${i}`,
      color,
      width: WIDTH,
      points: [
        [-300, rowY(i)],
        [230, rowY(i)],
      ],
    })),
  );
  await waitForStrokes(page);
  const shot = await page.screenshot();
  screenshots[scheme] = shot;
  writeFileSync(`${process.env.OUT ?? process.env.TMPDIR ?? "/tmp"}/visibility-${scheme}.png`, shot);
  const after = pixels(shot);

  for (const [i, [name]] of COLORS.entries()) {
    for (const [where, wx] of Object.entries(SPOTS)) {
      const p = await toPage(page, wx, rowY(i));
      const [x, y] = [p.x * dpr, p.y * dpr];
      // Outline sample: halfway through the 1.5 px outline, just past the line's edge.
      const off = (WIDTH / 2 + 0.75) * dpr;
      const bg = before(x, y);
      const core = after(x, y);
      const halo = after(x, y - off);
      const c = {
        coreVsBackground: contrast(core, bg),
        coreVsOutline: contrast(core, halo),
        outlineVsBackground: contrast(halo, bg),
      };
      const visible = c.coreVsBackground >= 3 || (c.coreVsOutline >= 3 && c.outlineVsBackground >= 3);
      results.push({ scheme, color: name, where, bg, core, halo, ...c, visible });
      check(`${scheme}: ${name} visible over the ${where}`, visible, { bg, core, halo, ...c });
    }
  }
  check(`${scheme}: no page errors`, errors.length === 0, errors);
  await browser.close();
}

console.log('\nscheme  colour  over   background      core            outline         core/bg core/outl outl/bg');
for (const r of results) {
  const f = (n) => n.toFixed(1).padStart(6);
  const rgb = (c) => `rgb(${c.join(',')})`.padEnd(16);
  console.log(
    `${r.scheme.padEnd(7)} ${r.color.padEnd(7)} ${r.where.padEnd(6)} ${rgb(r.bg)}${rgb(r.core)}${rgb(r.halo)}${f(r.coreVsBackground)} ${f(r.coreVsOutline)}   ${f(r.outlineVsBackground)}`,
  );
}

// 2. Hostile story CSS.
const HOSTILE = {
  'id selector': '#storybook-root canvas { position: relative; top: 40px; left: 60px }',
  ':root selector': ':root canvas { position: static; margin: 30px; width: 50%; height: 40% }',
  '!important layout':
    'canvas { position: static !important; transform: translate(100px, 50px) !important; margin: 30px !important; width: 50% !important; height: 30% !important; border: 5px solid red !important; padding: 12px !important; display: inline !important }',
  'individual transforms':
    'canvas { translate: 40px 40px !important; scale: 0.5 !important; rotate: 10deg !important }',
  'zoom and filter': 'canvas { zoom: 2 !important; filter: blur(3px) !important }',
  'box sizing and limits':
    'canvas { box-sizing: content-box !important; min-width: 3000px !important; max-height: 10px !important; aspect-ratio: 1 !important }',
  'hidden or faded':
    'canvas { opacity: 0.1 !important; visibility: hidden !important; clip-path: inset(50%) !important }',
  animation:
    '@keyframes shove { to { transform: translateX(300px); left: 200px } } canvas { animation: shove 1ms forwards }',
  'body > div': 'body > div canvas { position: fixed; inset: auto; width: 10px; height: 10px }',
};

const BUTTON = '[data-colab-frame="frame_btn"] button';
{
  await resetCanvas();
  const { browser, page, errors } = await openBoard('light');
  // A box around the Primary button, in world coordinates from the board model.
  const world = await previewFrame(page).evaluate((selector) => {
    const board = document.querySelector('[data-colab-board]');
    const { view } = JSON.parse(board.dataset.colabBoardState);
    const b = board.getBoundingClientRect();
    const r = document.querySelector(selector).getBoundingClientRect();
    const wx = (x) => (x - b.left - view.x) / view.zoom;
    const wy = (y) => (y - b.top - view.y) / view.zoom;
    return { left: wx(r.left), top: wy(r.top), right: wx(r.right), bottom: wy(r.bottom) };
  }, BUTTON);
  const m = 12;
  writeCanvas([
    {
      id: 'stroke_box',
      color: '#FF4400',
      width: 4,
      points: [
        [world.left - m, world.top - m],
        [world.right + m, world.top - m],
        [world.right + m, world.bottom + m],
        [world.left - m, world.bottom + m],
        [world.left - m, world.top - m],
      ],
    },
  ]);
  await waitForStrokes(page);

  const measure = () =>
    previewFrame(page).evaluate((selector) => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const board = document.querySelector('[data-colab-board]');
      const layers = {
        surface: board.querySelector(':scope > canvas:not([data-colab-stroke-layer])'),
        saved: board.querySelector('[data-colab-stroke-layer="saved"]'),
        live: board.querySelector('[data-colab-stroke-layer="live"]'),
      };
      const out = { board: rect(board), button: rect(document.querySelector(selector)), layers: {} };
      for (const [name, el] of Object.entries(layers)) {
        const s = getComputedStyle(el);
        out.layers[name] = {
          rect: rect(el),
          visible: s.visibility === 'visible' && s.opacity === '1' && s.filter === 'none' && s.clipPath === 'none',
        };
      }
      // Where the saved layer has ink, from its pixels, in preview CSS px.
      const canvas = layers.saved;
      const { width, height } = canvas;
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (data[(y * width + x) * 4 + 3] > 64) {
            l = Math.min(l, x);
            r = Math.max(r, x);
            t = Math.min(t, y);
            b = Math.max(b, y);
          }
      const cr = canvas.getBoundingClientRect();
      const sx = width / cr.width;
      out.ink = {
        left: cr.left + l / sx,
        top: cr.top + t / sx,
        right: cr.left + (r + 1) / sx,
        bottom: cr.top + (b + 1) / sx,
      };
      return out;
    }, BUTTON);

  const same = (a, b) => ['left', 'top', 'right', 'bottom'].every((k) => Math.abs(a[k] - b[k]) <= 0.5);
  const encloses = (o, i) => o.left < i.left && o.top < i.top && o.right > i.right && o.bottom > i.bottom;
  const tight = (o, i) =>
    o.left > i.left - 30 && o.top > i.top - 30 && o.right < i.right + 30 && o.bottom < i.bottom + 30;

  for (const [label, css] of Object.entries(HOSTILE)) {
    await previewFrame(page).evaluate((text) => {
      const style = document.createElement('style');
      style.id = 'hostile';
      style.textContent = text;
      document.head.append(style);
    }, css);
    await page.waitForTimeout(150);
    await settle(page);
    const r = await measure();
    for (const [name, layer] of Object.entries(r.layers)) {
      check(`${label}: ${name} canvas covers the board`, same(layer.rect, r.board) && layer.visible, {
        rect: layer.rect,
        board: r.board,
        visible: layer.visible,
      });
    }
    check(`${label}: the box still surrounds the button`, encloses(r.ink, r.button) && tight(r.ink, r.button), {
      ink: r.ink,
      button: r.button,
    });
    await previewFrame(page).evaluate(() => document.getElementById('hostile').remove());
  }
  check('hostile CSS: no page errors', errors.length === 0, errors);
  await browser.close();
}

await resetCanvas();
done();
