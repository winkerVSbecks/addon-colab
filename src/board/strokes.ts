/**
 * Freehand stroke maths, in world coordinates (the canvas file's CSS pixels at zoom 1).
 *
 * A stroke is captured as raw pointer samples while drawing, then simplified once on pointer up
 * (Ramer-Douglas-Peucker, then rounded to 0.1 px) so the file holds a few dozen to a few hundred
 * points per stroke, not thousands. Pure functions only, shared by the stroke layer, the eraser
 * and the tests.
 */
import type { Stroke } from '../canvas-file';
import type { Point, Rect } from './viewport';

export type StrokePoint = [number, number];

/** The most points one saved stroke keeps; simplification gets coarser until it fits. */
export const MAX_STROKE_POINTS = 300;

/**
 * How far (in screen pixels) a simplified line may stray from what was drawn. Converted to world
 * pixels with the zoom at which the stroke was drawn, so a stroke drawn zoomed in keeps its detail.
 */
export const SIMPLIFY_SCREEN_TOLERANCE = 0.75;

/** The ink colour that follows the theme: stored as `currentColor`, drawn in the theme's text colour. */
export const THEME_INK = 'currentColor';

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Squared distance from `p` to the segment `a`–`b`. */
export function segmentDistanceSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx - p.x;
  const y = a.y + t * dy - p.y;
  return x * x + y * y;
}

const toPoint = ([x, y]: StrokePoint): Point => ({ x, y });

/** Ramer-Douglas-Peucker on a polyline: keeps the end points and every point further than `tolerance`. */
export function simplifyPolyline(points: readonly StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const toleranceSq = tolerance * tolerance;
  // Iterative, so a very long stroke cannot overflow the stack.
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const a = toPoint(points[first]!);
    const b = toPoint(points[last]!);
    let worst = -1;
    let worstSq = toleranceSq;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistanceSq(toPoint(points[i]!), a, b);
      if (d > worstSq) {
        worstSq = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Drops consecutive points closer than `minDistance` (keeps the last one, so the stroke ends where it ended). */
function dropNearDuplicates(points: readonly StrokePoint[], minDistance: number): StrokePoint[] {
  if (points.length <= 2) return points.slice();
  const result: StrokePoint[] = [points[0]!];
  const minSq = minDistance * minDistance;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = result[result.length - 1]!;
    const [x, y] = points[i]!;
    if ((x - px) ** 2 + (y - py) ** 2 >= minSq) result.push(points[i]!);
  }
  result.push(points[points.length - 1]!);
  return result;
}

/**
 * The points to save for a stroke drawn at `zoom`: simplified, rounded to 0.1 world px, and at most
 * `maxPoints` long. A tap (one point, or all points in one place) stays a single point (a dot).
 */
export function simplifyStroke(
  points: readonly StrokePoint[],
  zoom: number,
  { maxPoints = MAX_STROKE_POINTS, screenTolerance = SIMPLIFY_SCREEN_TOLERANCE } = {},
): StrokePoint[] {
  const finite = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (finite.length === 0) return [];
  const worldPerScreen = 1 / (zoom > 0 ? zoom : 1);
  let tolerance = screenTolerance * worldPerScreen;
  let result = simplifyPolyline(dropNearDuplicates(finite, tolerance / 2), tolerance);
  // Too many points: coarser, but never so coarse that loops collapse (at most 4 screen px off).
  while (result.length > maxPoints && tolerance < MAX_COARSE_SCREEN_TOLERANCE * worldPerScreen) {
    tolerance = Math.min(tolerance * 1.5, MAX_COARSE_SCREEN_TOLERANCE * worldPerScreen);
    result = simplifyPolyline(dropNearDuplicates(finite, tolerance / 2), tolerance);
  }
  // Still too many (a very long, dense scribble): keep evenly spaced points, ends included.
  if (result.length > maxPoints) result = evenlySpaced(result, maxPoints);
  const rounded = result.map(([x, y]): StrokePoint => [round1(x), round1(y)]);
  return rounded.filter((p, i) => i === 0 || p[0] !== rounded[i - 1]![0] || p[1] !== rounded[i - 1]![1]);
}

/** The most a stroke over its point budget may stray from what was drawn, in screen pixels. */
const MAX_COARSE_SCREEN_TOLERANCE = 4;

function evenlySpaced(points: readonly StrokePoint[], count: number): StrokePoint[] {
  const result: StrokePoint[] = [];
  for (let i = 0; i < count; i++) result.push(points[Math.round((i * (points.length - 1)) / (count - 1))]!);
  return result;
}

/** The area a stroke covers, including half its line width on every side. */
export function strokeBounds(stroke: Pick<Stroke, 'points' | 'width'>): Rect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [x, y] of stroke.points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  const half = stroke.width / 2;
  return { x: left - half, y: top - half, width: right - left + stroke.width, height: bottom - top + stroke.width };
}

/** Whether a world point is on the stroke's line, give or take `slop` world pixels. */
export function strokeHit(stroke: Pick<Stroke, 'points' | 'width'>, point: Point, slop = 0): boolean {
  const reach = stroke.width / 2 + slop;
  const reachSq = reach * reach;
  const { points } = stroke;
  if (points.length === 0) return false;
  if (points.length === 1) return segmentDistanceSq(point, toPoint(points[0]!), toPoint(points[0]!)) <= reachSq;
  for (let i = 1; i < points.length; i++) {
    if (segmentDistanceSq(point, toPoint(points[i - 1]!), toPoint(points[i]!)) <= reachSq) return true;
  }
  return false;
}

/**
 * The topmost stroke (the last drawn) under a world point, for the eraser. `slop` is in world
 * pixels, so callers pass a screen tolerance divided by the zoom.
 */
export function strokeAt<S extends Pick<Stroke, 'points' | 'width'>>(
  strokes: readonly S[],
  point: Point,
  slop = 0,
): S | undefined {
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokeHit(strokes[i]!, point, slop)) return strokes[i];
  }
  return undefined;
}

/**
 * Strokes crossed by the eraser moving from `from` to `to` (sampled along the way, so a fast swipe
 * does not skip a thin stroke).
 */
export function strokesAlong<S extends Pick<Stroke, 'points' | 'width'>>(
  strokes: readonly S[],
  from: Point,
  to: Point,
  slop: number,
): S[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, slop)));
  const hit = new Set<S>();
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    for (const stroke of strokes) if (!hit.has(stroke) && strokeHit(stroke, p, slop)) hit.add(stroke);
  }
  return strokes.filter((stroke) => hit.has(stroke));
}

/**
 * The line width to save for a pen stroke: the chosen width scaled by the pen's average pressure
 * (0.5 is "normal"), within half to one and a half times the chosen width. Mice and touch report no
 * real pressure, so their strokes keep the chosen width.
 */
export function pressureWidth(width: number, pressures: readonly number[]): number {
  const real = pressures.filter((p) => p > 0 && p <= 1);
  if (real.length === 0) return width;
  const mean = real.reduce((sum, p) => sum + p, 0) / real.length;
  const scale = Math.max(0.5, Math.min(1.5, mean * 2));
  return round1(width * scale);
}
