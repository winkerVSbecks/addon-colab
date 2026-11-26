import { describe, expect, it } from 'vitest';

import { inStableOrder, isOnTop, raiseSettled, withRaised } from './frame-order';

const a = { id: 'a' };
const b = { id: 'b' };
const c = { id: 'c' };
const ids = (frames: readonly { id: string }[]) => frames.map((frame) => frame.id).join('');

describe('stacking order', () => {
  it('the last frame is on top', () => {
    expect(isOnTop([a, b, c], 'c')).toBe(true);
    expect(isOnTop([a, b, c], 'a')).toBe(false);
    expect(isOnTop([], 'a')).toBe(false);
  });

  it('raising moves a frame to the end and keeps the others in order', () => {
    expect(ids(withRaised([a, b, c], 'a'))).toBe('bca');
    expect(ids(withRaised([a, b, c], 'b'))).toBe('acb');
  });

  it('raising changes nothing for the top frame, an unknown frame or no frame', () => {
    const frames = [a, b, c];
    expect(withRaised(frames, 'c')).toBe(frames);
    expect(withRaised(frames, 'x')).toBe(frames);
    expect(withRaised(frames, null)).toBe(frames);
  });

  it('a local raise is settled once the file has the frame on top, or has lost it', () => {
    expect(raiseSettled([a, b, c], 'a')).toBe(false);
    expect(raiseSettled([b, c, a], 'a')).toBe(true);
    expect(raiseSettled([b, c], 'a')).toBe(true);
  });

  it('the stable order ignores stacking', () => {
    expect(ids(inStableOrder([c, a, b]))).toBe('abc');
    expect(ids(inStableOrder(withRaised([a, b, c], 'a')))).toBe('abc');
  });
});
