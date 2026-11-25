import { Channel } from 'storybook/internal/channels';
import { describe, expect, it, vi } from 'vitest';

import { THEME_CHANGED, followManagerTheme, serveManagerTheme } from './theme-sync';
import { canvasThemeParameters, chooseCanvasTheme } from './ui-theme';

const dark = { base: 'dark', appBg: '#222' } as never;
const light = { base: 'light', appBg: '#fff' } as never;

describe('manager theme for the canvas page', () => {
  it('answers a canvas page that asks, and sends later changes', () => {
    // A channel without a transport delivers emits to its own listeners, like manager ↔ preview.
    const channel = new Channel({});
    const send = serveManagerTheme(channel, () => dark);
    const seen = vi.fn();
    const stop = followManagerTheme(channel, seen);
    expect(seen).toHaveBeenLastCalledWith(dark);
    send(light);
    expect(seen).toHaveBeenLastCalledWith(light);
    stop();
    send(dark);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('ignores payloads that are not a theme', () => {
    const channel = new Channel({});
    const seen = vi.fn();
    followManagerTheme(channel, seen);
    for (const payload of ['nope', '{}', JSON.stringify({ base: 'blue' }), 42]) channel.emit(THEME_CHANGED, payload);
    expect(seen).not.toHaveBeenCalled();
  });

  it('prefers colab.theme, then the manager theme, then docs.theme', () => {
    expect(canvasThemeParameters({ colab: { theme: 'light' }, docs: { theme: 'dark' } })).toEqual({
      theme: 'light',
      fallback: 'dark',
    });
    expect(chooseCanvasTheme({ theme: 'light', manager: dark, fallback: 'light' })).toBe('light');
    // A forced dark manager wins over a light docs theme or a light system scheme.
    expect(chooseCanvasTheme({ manager: dark, fallback: 'light' })).toBe(dark);
    expect(chooseCanvasTheme({ fallback: 'dark' })).toBe('dark');
    expect(chooseCanvasTheme({})).toBeUndefined();
  });
});
