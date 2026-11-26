import { describe, expect, it } from 'vitest';

import type { Anchor, Comment, ElementTarget } from '../canvas-file';
import {
  type ElementOffset,
  anchorFrameId,
  anchorStoryId,
  describeAnchor,
  describeTarget,
  pinBounds,
  pinPlacement,
  sortComments,
  stackIndexes,
  timeAgo,
} from './comment-pins';

const frames = new Map([['frame_hdr', { id: 'frame_hdr', x: 420, y: 10, width: 960 }]]);
const target: ElementTarget = {
  storyId: 'example-header--logged-out',
  title: 'Example/Header',
  importPath: './src/stories/Header.stories.ts',
  selector: 'button.storybook-button--secondary',
  html: '<button type="button">Log in</button>',
  text: 'Log in',
  role: 'button',
  name: 'Log in',
};
const elementAnchor: Anchor = { type: 'element', frameId: 'frame_hdr', target };
const at = (offset: ElementOffset) => () => offset;

describe('pinPlacement', () => {
  it('puts a position pin at its point, negative coordinates included', () => {
    expect(pinPlacement({ type: 'position', x: -120, y: -40 }, frames, at({ kind: 'pending' }))).toEqual({
      state: 'attached',
      point: { x: -120, y: -40 },
    });
  });

  it('puts a frame pin at the corner, or at its offset from the corner', () => {
    const corner = pinPlacement({ type: 'frame', frameId: 'frame_hdr', storyId: 's' }, frames, at({ kind: 'pending' }));
    expect(corner).toEqual({ state: 'attached', point: { x: 420, y: 10 }, frameId: 'frame_hdr' });
    const offset = pinPlacement(
      { type: 'frame', frameId: 'frame_hdr', storyId: 's', x: 30, y: 5 },
      frames,
      at({ kind: 'pending' }),
    );
    expect(offset).toMatchObject({ point: { x: 450, y: 15 } });
  });

  it('puts an element pin at the element, following the frame', () => {
    const placed = pinPlacement(elementAnchor, frames, at({ kind: 'offset', offset: { x: 800, y: 20 } }));
    expect(placed).toEqual({ state: 'attached', point: { x: 1220, y: 30 }, frameId: 'frame_hdr' });
    const moved = new Map([['frame_hdr', { id: 'frame_hdr', x: 0, y: 0, width: 960 }]]);
    expect(pinPlacement(elementAnchor, moved, at({ kind: 'offset', offset: { x: 800, y: 20 } }))).toMatchObject({
      point: { x: 800, y: 20 },
    });
  });

  it('falls back to the frame corner when the element is gone (detached) or not rendered yet', () => {
    expect(pinPlacement(elementAnchor, frames, at({ kind: 'detached' }))).toEqual({
      state: 'detached',
      point: { x: 420, y: 10 },
      frameId: 'frame_hdr',
    });
    expect(pinPlacement(elementAnchor, frames, at({ kind: 'pending' }))).toMatchObject({ state: 'pending' });
  });

  it('has no place on the board for an anchor to a removed frame', () => {
    expect(pinPlacement({ ...elementAnchor, frameId: 'frame_gone' }, frames, at({ kind: 'detached' }))).toEqual({
      state: 'orphan',
      frameId: 'frame_gone',
    });
    expect(
      pinPlacement({ type: 'frame', frameId: 'frame_gone', storyId: 's', x: 1, y: 1 }, frames, at({ kind: 'pending' })),
    ).toEqual({ state: 'orphan', frameId: 'frame_gone' });
  });
});

describe('stackIndexes', () => {
  it('numbers pins that share a spot, so several comments on one anchor fan out', () => {
    const indexes = stackIndexes([
      { id: 'a', point: { x: 10, y: 10 } },
      { id: 'b', point: { x: 10.2, y: 9.9 } },
      { id: 'c', point: { x: 50, y: 10 } },
      { id: 'd', point: { x: 10, y: 10 } },
    ]);
    expect([...indexes]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
      ['d', 2],
    ]);
  });
});

describe('anchors and descriptions', () => {
  it('knows the frame and story of each anchor type', () => {
    expect(anchorFrameId(elementAnchor)).toBe('frame_hdr');
    expect(anchorStoryId(elementAnchor)).toBe('example-header--logged-out');
    expect(anchorStoryId({ type: 'frame', frameId: 'f', storyId: 's' })).toBe('s');
    expect(anchorFrameId({ type: 'position', x: 0, y: 0 })).toBeUndefined();
  });

  it('describes targets and anchors in a few words', () => {
    expect(describeTarget(target)).toBe('button “Log in”');
    expect(describeTarget({ html: '<h1>Acme</h1>', text: 'Acme' })).toBe('h1 “Acme”');
    expect(describeTarget({ html: '<div></div>', text: '' })).toBe('div');
    expect(describeTarget({ html: '<p>x</p>', text: 'y'.repeat(100) })).toMatch(/^p “y+…”$/);
    const name = () => 'Header';
    expect(describeAnchor(elementAnchor, name)).toBe('button “Log in” in Header');
    expect(describeAnchor({ type: 'frame', frameId: 'f', storyId: 's' }, name)).toBe('Header');
    expect(describeAnchor({ type: 'position', x: 0, y: 0 }, name)).toBe('On the canvas');
  });
});

describe('sortComments', () => {
  const comment = (id: string, status: 'open' | 'resolved', createdAt: string): Comment => ({
    id,
    author: 'user',
    body: id,
    status,
    anchor: { type: 'position', x: 0, y: 0 },
    createdAt,
    ...(status === 'resolved' ? { resolvedAt: createdAt } : {}),
    replies: [],
  });

  it('lists open comments first, oldest first', () => {
    const sorted = sortComments([
      comment('r', 'resolved', '2026-01-01T00:00:00.000Z'),
      comment('b', 'open', '2026-01-03T00:00:00.000Z'),
      comment('a', 'open', '2026-01-02T00:00:00.000Z'),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b', 'r']);
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-11-25T12:00:00.000Z');
  it.each([
    ['2026-11-25T11:59:50.000Z', 'just now'],
    ['2026-11-25T11:55:00.000Z', '5 min ago'],
    ['2026-11-25T09:00:00.000Z', '3 h ago'],
    ['2026-11-23T12:00:00.000Z', '2 d ago'],
    ['2026-10-01T12:00:00.000Z', '2026-10-01'],
    ['2026-11-25T12:05:00.000Z', 'just now'],
  ])('%s is %s', (iso, text) => expect(timeAgo(iso, now)).toBe(text));
});

describe('pinBounds', () => {
  const comment = (id: string, anchor: Anchor, status: 'open' | 'resolved' = 'open'): Comment => ({
    id,
    author: 'user',
    body: id,
    status,
    ...(status === 'resolved' ? { resolvedAt: '2026-11-25T12:00:00.000Z' } : {}),
    anchor,
    createdAt: '2026-11-25T12:00:00.000Z',
    replies: [],
  });

  it('boxes open position pins and frame pins with an offset, drawn above their point', () => {
    const boxes = pinBounds(
      [
        comment('comment-pos', { type: 'position', x: -200, y: -150 }),
        comment('comment-frame', { type: 'frame', frameId: 'frame_hdr', storyId: 's', x: 1200, y: 40 }),
        comment('comment-corner', { type: 'frame', frameId: 'frame_hdr', storyId: 's' }),
        comment('comment-el', elementAnchor),
        comment('comment-gone', { type: 'frame', frameId: 'frame_gone', storyId: 's', x: 5, y: 5 }),
        comment('comment-done', { type: 'position', x: 5000, y: 5000 }, 'resolved'),
      ],
      frames,
      28,
    );
    expect(boxes).toEqual([
      { x: -200, y: -178, width: 28, height: 28 },
      { x: 1620, y: 22, width: 28, height: 28 },
    ]);
  });
});
