/**
 * Board viewport math. World coordinates are the canvas file's coordinates (CSS pixels at zoom 1);
 * screen coordinates are CSS pixels relative to the board's top-left corner.
 *
 *   screen = world * zoom + (x, y)
 *
 * Pure functions only, so drawing, hit-testing, drops and the overlay all share one definition.
 */

export interface Viewport {
  /** Screen position of the world origin. */
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

/** Steps for the zoom buttons; the same levels as Storybook's own zoom tool, within the board's range. */
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3, 4] as const;

export const DEFAULT_VIEWPORT: Viewport = { x: 40, y: 56, zoom: 1 };

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(view: Viewport, point: Point): Point {
  return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom };
}

export function worldToScreen(view: Viewport, point: Point): Point {
  return { x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y };
}

export function worldRectToScreen(view: Viewport, rect: Rect): Rect {
  const { x, y } = worldToScreen(view, rect);
  return { x, y, width: rect.width * view.zoom, height: rect.height * view.zoom };
}

export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/** Zooms to `zoom` (clamped) while keeping the world point under the screen point `anchor` in place. */
export function zoomAt(view: Viewport, anchor: Point, zoom: number): Viewport {
  const next = clampZoom(zoom);
  const world = screenToWorld(view, anchor);
  return { zoom: next, x: anchor.x - world.x * next, y: anchor.y - world.y * next };
}

/** How much one wheel event zooms. `deltaY` is in pixels; pinch gestures arrive as ctrl+wheel. */
export function wheelZoomFactor(deltaY: number): number {
  // Clamp so one notch of a coarse mouse wheel does not jump several steps.
  const delta = Math.max(-50, Math.min(50, deltaY));
  return Math.exp(-delta / 100);
}

/** Converts a WheelEvent delta to pixels (`deltaMode` 1 = lines, 2 = pages). */
export function wheelDeltaToPixels(delta: number, deltaMode: number, pageSize = 800): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * pageSize;
  return delta;
}

/** The next zoom step in a direction, from the current (possibly in-between) zoom. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const epsilon = 1e-6;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > zoom + epsilon) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - epsilon) ?? MIN_ZOOM;
}

/** The bounding box of some rects, or `undefined` for none. */
export function boundsOf(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A viewport that shows `bounds` inside a screen of `size`, with `padding` around it, never zoomed
 * in further than `maxZoom` (so a single small story is not blown up). `topInset` leaves room for
 * frame titles drawn above the frames.
 */
export function fitViewport(
  bounds: Rect,
  size: Size,
  { padding = 48, maxZoom = 1, topInset = 24 }: { padding?: number; maxZoom?: number; topInset?: number } = {},
): Viewport {
  const availableWidth = Math.max(1, size.width - padding * 2);
  const availableHeight = Math.max(1, size.height - padding * 2 - topInset);
  const zoom = clampZoom(
    Math.min(maxZoom, availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)),
  );
  const x = (size.width - bounds.width * zoom) / 2 - bounds.x * zoom;
  const y = topInset + (size.height - topInset - bounds.height * zoom) / 2 - bounds.y * zoom;
  return { x, y, zoom };
}

export function isViewport(value: unknown): value is Viewport {
  if (!value || typeof value !== 'object') return false;
  const { x, y, zoom } = value as Record<string, unknown>;
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    typeof zoom === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    zoom >= MIN_ZOOM &&
    zoom <= MAX_ZOOM
  );
}
