import { describe, expect, it } from 'vitest';

import { HALO_DARK, HALO_LIGHT, contrastRatio, haloFor, parseRgb, relativeLuminance } from './stroke-halo';

describe('parseRgb', () => {
  it('reads hex and rgb()/rgba() colours', () => {
    expect(parseRgb('#fff')).toEqual([255, 255, 255]);
    expect(parseRgb('#2E3338')).toEqual([46, 51, 56]);
    expect(parseRgb('#2e3338cc')).toEqual([46, 51, 56]);
    expect(parseRgb('rgb(201, 204, 207)')).toEqual([201, 204, 207]);
    expect(parseRgb('rgba(201,204,207,0.5)')).toEqual([201, 204, 207]);
    expect(parseRgb('rgb(201 204 207 / 50%)')).toEqual([201, 204, 207]);
  });

  it('returns undefined for anything else', () => {
    expect(parseRgb('red')).toBeUndefined();
    expect(parseRgb('currentColor')).toBeUndefined();
    expect(parseRgb('#12')).toBeUndefined();
  });
});

describe('contrast', () => {
  it('follows WCAG relative luminance', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21);
    // The verifier's number: dark-theme ink over a white story.
    expect(contrastRatio([201, 204, 207], [255, 255, 255])).toBeCloseTo(1.6, 1);
  });
});

describe('haloFor', () => {
  it('outlines light strokes in dark and dark strokes in light', () => {
    expect(haloFor([201, 204, 207])).toBe(HALO_DARK);
    expect(haloFor([255, 174, 0])).toBe(HALO_DARK);
    expect(haloFor([46, 51, 56])).toBe(HALO_LIGHT);
    expect(haloFor([111, 44, 172])).toBe(HALO_LIGHT);
  });

  it('gives every stroke at least 4:1 against its outline', () => {
    for (const rgb of [
      [0, 0, 0],
      [255, 255, 255],
      [128, 128, 128],
      [118, 118, 118],
      [255, 68, 0],
      [102, 191, 60],
      [2, 156, 253],
    ] as [number, number, number][]) {
      expect(contrastRatio(rgb, parseRgb(haloFor(rgb))!)).toBeGreaterThanOrEqual(4);
    }
  });
});
