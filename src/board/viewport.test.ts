import { describe, expect, it } from 'vitest';

import {
  MAX_ZOOM,
  MIN_ZOOM,
  boundsOf,
  clampZoom,
  fitViewport,
  isViewport,
  panBy,
  screenToWorld,
  stepZoom,
  wheelDeltaToPixels,
  wheelZoomFactor,
  worldRectToScreen,
  worldToScreen,
  zoomAt,
} from './viewport';

describe('viewport', () => {
  it('converts between screen and world coordinates in both directions', () => {
    const view = { x: 120, y: -40, zoom: 2 };
    expect(worldToScreen(view, { x: 10, y: 30 })).toEqual({ x: 140, y: 20 });
    expect(screenToWorld(view, { x: 140, y: 20 })).toEqual({ x: 10, y: 30 });
    for (const zoom of [0.5, 1, 2]) {
      const v = { x: 33, y: 71, zoom };
      const world = { x: 380, y: 280 };
      expect(screenToWorld(v, worldToScreen(v, world))).toEqual(world);
    }
  });

  it('maps a world rect to screen pixels', () => {
    expect(worldRectToScreen({ x: 10, y: 20, zoom: 0.5 }, { x: 100, y: 40, width: 400, height: 200 })).toEqual({
      x: 60,
      y: 40,
      width: 200,
      height: 100,
    });
  });

  it('keeps the point under the pointer fixed when zooming', () => {
    const view = { x: 50, y: 60, zoom: 1 };
    const anchor = { x: 300, y: 200 };
    const before = screenToWorld(view, anchor);
    const zoomed = zoomAt(view, anchor, 2);
    expect(zoomed.zoom).toBe(2);
    const after = screenToWorld(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom to the supported range', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 50).zoom).toBe(MAX_ZOOM);
  });

  it('pans by a screen delta', () => {
    expect(panBy({ x: 1, y: 2, zoom: 3 }, 10, -5)).toEqual({ x: 11, y: -3, zoom: 3 });
  });

  it('zooms in for an upward wheel and out for a downward one, at most one step per event', () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    expect(wheelZoomFactor(1000)).toBeCloseTo(wheelZoomFactor(50));
    expect(wheelDeltaToPixels(3, 1)).toBe(48);
    expect(wheelDeltaToPixels(1, 2, 500)).toBe(500);
    expect(wheelDeltaToPixels(7, 0)).toBe(7);
  });

  it('steps between zoom levels, including from an in-between zoom', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.6, 1)).toBe(0.75);
    expect(stepZoom(0.6, -1)).toBe(0.5);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('fits content into the screen without zooming in past the limit', () => {
    const bounds = boundsOf([
      { x: 0, y: 0, width: 400, height: 300 },
      { x: 600, y: 100, width: 400, height: 500 },
    ])!;
    expect(bounds).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
    const size = { width: 1200, height: 800 };
    const view = fitViewport(bounds, size);
    expect(view.zoom).toBe(1);
    // Centred horizontally.
    const left = worldToScreen(view, { x: 0, y: 0 }).x;
    const right = worldToScreen(view, { x: 1000, y: 0 }).x;
    expect(left).toBeCloseTo(size.width - right);

    const small = fitViewport(bounds, { width: 600, height: 400 });
    expect(small.zoom).toBeLessThan(1);
    const topLeft = worldToScreen(small, { x: 0, y: 0 });
    const bottomRight = worldToScreen(small, { x: 1000, y: 600 });
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(24);
    expect(bottomRight.x).toBeLessThanOrEqual(600);
    expect(bottomRight.y).toBeLessThanOrEqual(400);
    expect(boundsOf([])).toBeUndefined();
  });

  it('recognises stored viewports and rejects anything else', () => {
    expect(isViewport({ x: 1, y: 2, zoom: 1 })).toBe(true);
    expect(isViewport({ x: 1, y: 2, zoom: 99 })).toBe(false);
    expect(isViewport({ x: '1', y: 2, zoom: 1 })).toBe(false);
    expect(isViewport(null)).toBe(false);
  });
});
