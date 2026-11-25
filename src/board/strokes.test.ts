import { describe, expect, it } from 'vitest';

import {
  MAX_STROKE_POINTS,
  type StrokePoint,
  pressureWidth,
  segmentDistanceSq,
  simplifyPolyline,
  simplifyStroke,
  strokeAt,
  strokeBounds,
  strokeHit,
  strokesAlong,
} from './strokes';

/** A wobbly scribble like a real hand: `loops` loops drifting right, with jitter, sampled `samples` times. */
function scribble(samples: number, { loops = 6, seed = 1 } = {}): StrokePoint[] {
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const points: StrokePoint[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * loops * Math.PI * 2;
    points.push([200 + t * 20 + Math.cos(t) * 60 + random() * 0.3, 150 + Math.sin(t) * 60 + random() * 0.3]);
  }
  return points;
}

/** The furthest any original point lies from the simplified polyline. */
function maxDeviation(original: readonly StrokePoint[], simplified: readonly StrokePoint[]): number {
  let worst = 0;
  for (const [x, y] of original) {
    let best = Infinity;
    for (let i = 1; i < simplified.length; i++) {
      const [ax, ay] = simplified[i - 1]!;
      const [bx, by] = simplified[i]!;
      best = Math.min(best, segmentDistanceSq({ x, y }, { x: ax, y: ay }, { x: bx, y: by }));
    }
    worst = Math.max(worst, Math.sqrt(best));
  }
  return worst;
}

describe('segmentDistanceSq', () => {
  it('measures to the nearest point of the segment, including its ends', () => {
    expect(segmentDistanceSq({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(9);
    expect(segmentDistanceSq({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(25);
    expect(segmentDistanceSq({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(2);
  });
});

describe('simplifyPolyline', () => {
  it('drops points on a straight line and keeps corners', () => {
    const line: StrokePoint[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 5],
      [10, 10],
    ];
    expect(simplifyPolyline(line, 0.5)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it('keeps short inputs as they are', () => {
    expect(simplifyPolyline([[1, 2]], 1)).toEqual([[1, 2]]);
    expect(simplifyPolyline([], 1)).toEqual([]);
  });

  it('handles very long inputs without recursion limits', () => {
    const long = scribble(200_000);
    expect(() => simplifyPolyline(long, 0.5)).not.toThrow();
  });
});

describe('simplifyStroke', () => {
  it('keeps a long scribble to a few hundred points, close to what was drawn', () => {
    const raw = scribble(5000);
    const saved = simplifyStroke(raw, 1);
    expect(saved.length).toBeLessThanOrEqual(MAX_STROKE_POINTS);
    expect(saved.length).toBeLessThan(raw.length / 10);
    expect(saved[0]).toEqual([Math.round(raw[0]![0] * 10) / 10, Math.round(raw[0]![1] * 10) / 10]);
    // Within the screen tolerance plus rounding, unless it had to get coarser to fit.
    expect(maxDeviation(raw, saved)).toBeLessThan(3);
  });

  it('gets coarser rather than exceed the point budget', () => {
    const raw = scribble(50_000, { loops: 40, seed: 7 });
    const saved = simplifyStroke(raw, 4, { maxPoints: 100 });
    expect(saved.length).toBeLessThanOrEqual(100);
    expect(saved.length).toBeGreaterThan(10);
  });

  it('keeps more detail for a stroke drawn zoomed in', () => {
    const raw = scribble(3000, { seed: 3 });
    expect(simplifyStroke(raw, 4).length).toBeGreaterThan(simplifyStroke(raw, 0.5).length);
  });

  it('rounds to 0.1 world px, so the file stays short', () => {
    const saved = simplifyStroke(
      [
        [1.23456, 2.98765],
        [50.04999, 80.123],
      ],
      1,
    );
    expect(saved).toEqual([
      [1.2, 3],
      [50, 80.1],
    ]);
    expect(JSON.stringify(saved).length).toBeLessThan(30);
  });

  it('keeps a tap as one point and drops non-finite samples', () => {
    expect(simplifyStroke([[10, 10]], 1)).toEqual([[10, 10]]);
    expect(
      simplifyStroke(
        [
          [10, 10],
          [10.01, 10.01],
          [10, 10],
        ],
        1,
      ),
    ).toEqual([[10, 10]]);
    expect(
      simplifyStroke(
        [
          [Number.NaN, 1],
          [3, 4],
        ],
        1,
      ),
    ).toEqual([[3, 4]]);
    expect(simplifyStroke([], 1)).toEqual([]);
  });

  it('keeps a sharp V shape', () => {
    const v: StrokePoint[] = [];
    for (let i = 0; i <= 50; i++) v.push([i, i]);
    for (let i = 1; i <= 50; i++) v.push([50 + i, 50 - i]);
    expect(simplifyStroke(v, 1)).toEqual([
      [0, 0],
      [50, 50],
      [100, 0],
    ]);
  });
});

describe('strokeBounds', () => {
  it('includes half the line width', () => {
    expect(
      strokeBounds({
        width: 4,
        points: [
          [10, 20],
          [30, 5],
        ],
      }),
    ).toEqual({ x: 8, y: 3, width: 24, height: 19 });
    expect(strokeBounds({ width: 2, points: [[5, 5]] })).toEqual({ x: 4, y: 4, width: 2, height: 2 });
  });
});

describe('hit testing', () => {
  const a = {
    id: 'a',
    width: 4,
    points: [
      [0, 0],
      [100, 0],
    ] as StrokePoint[],
  };
  const b = {
    id: 'b',
    width: 2,
    points: [
      [50, -50],
      [50, 50],
    ] as StrokePoint[],
  };
  const dot = { id: 'dot', width: 6, points: [[200, 200]] as StrokePoint[] };

  it('hits within half the width plus slop', () => {
    expect(strokeHit(a, { x: 50, y: 2 })).toBe(true);
    expect(strokeHit(a, { x: 50, y: 3 })).toBe(false);
    expect(strokeHit(a, { x: 50, y: 3 }, 1.5)).toBe(true);
    expect(strokeHit(dot, { x: 202, y: 202 })).toBe(true);
    expect(strokeHit({ width: 2, points: [] }, { x: 0, y: 0 }, 10)).toBe(false);
  });

  it('picks the topmost (last) stroke under the point', () => {
    expect(strokeAt([a, b], { x: 50, y: 0 })?.id).toBe('b');
    expect(strokeAt([b, a], { x: 50, y: 0 })?.id).toBe('a');
    expect(strokeAt([a, b], { x: 10, y: 0 })?.id).toBe('a');
    expect(strokeAt([a, b], { x: 10, y: 40 })).toBeUndefined();
  });

  it('finds every stroke a fast eraser swipe crosses', () => {
    expect(strokesAlong([a, b, dot], { x: 20, y: -30 }, { x: 80, y: 30 }, 1).map((s) => s.id)).toEqual(['a', 'b']);
    expect(strokesAlong([a, b, dot], { x: 150, y: 150 }, { x: 150, y: 160 }, 1)).toEqual([]);
  });
});

describe('pressureWidth', () => {
  it('scales by average pen pressure, within limits', () => {
    expect(pressureWidth(4, [])).toBe(4);
    expect(pressureWidth(4, [0, 0])).toBe(4);
    expect(pressureWidth(4, [0.5, 0.5])).toBe(4);
    expect(pressureWidth(4, [1, 1])).toBe(6);
    expect(pressureWidth(4, [0.05])).toBe(2);
  });
});
