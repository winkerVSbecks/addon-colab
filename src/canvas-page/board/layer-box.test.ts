// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { LAYER_BOX, pinStyle } from './layer-box';

describe('pinStyle', () => {
  it('sets each property inline as important', () => {
    const canvas = document.createElement('canvas');
    pinStyle(canvas, { ...LAYER_BOX, 'z-index': '1' });
    expect(canvas.style.getPropertyValue('position')).toBe('absolute');
    expect(canvas.style.getPropertyPriority('position')).toBe('important');
    expect(canvas.style.getPropertyValue('z-index')).toBe('1');
    expect(canvas.style.getPropertyPriority('transform')).toBe('important');
  });
});
