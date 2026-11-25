import { describe, expect, it } from 'vitest';

import {
  ASSUMED_FRAME_HEIGHT,
  FRAME_GAP,
  MAX_FRAME_SIZE,
  clampFrameSize,
  defaultFrameWidth,
  frameRect,
  nextFramePosition,
  storyLayout,
} from './frame-defaults';

describe('frame defaults', () => {
  it('picks a width from the story layout, defaulting to padded like Storybook', () => {
    expect(storyLayout({ layout: 'fullscreen' })).toBe('fullscreen');
    expect(storyLayout({ layout: 'centered' })).toBe('centered');
    expect(storyLayout({})).toBe('padded');
    expect(storyLayout(undefined)).toBe('padded');
    expect(defaultFrameWidth({ layout: 'fullscreen' })).toBeGreaterThan(defaultFrameWidth({}));
    expect(defaultFrameWidth({})).toBeGreaterThan(defaultFrameWidth({ layout: 'centered' }));
  });

  it('places a new frame to the right of everything, top-aligned', () => {
    expect(nextFramePosition([])).toEqual({ x: 0, y: 0 });
    expect(
      nextFramePosition([
        { x: 0, y: 40, width: 360 },
        { x: 500, y: -20, width: 960, height: 80 },
      ]),
    ).toEqual({ x: 1460 + FRAME_GAP, y: -20 });
  });

  it('clamps and rounds sizes', () => {
    expect(clampFrameSize(10.4, 120)).toBe(120);
    expect(clampFrameSize(250.6, 120)).toBe(251);
    expect(clampFrameSize(1e9, 120)).toBe(MAX_FRAME_SIZE);
    expect(clampFrameSize(Number.NaN, 40)).toBe(40);
  });

  it('uses the measured, stored or assumed height for a frame rect', () => {
    const frame = { x: 1, y: 2, width: 300 };
    expect(frameRect(frame).height).toBe(ASSUMED_FRAME_HEIGHT);
    expect(frameRect({ ...frame, height: 90 }).height).toBe(90);
    expect(frameRect({ ...frame, height: 90 }, 120).height).toBe(120);
  });
});
