/**
 * Shared rules for new frames, used by the board (drops) and the manager ("Add to canvas").
 * No runtime imports, so both bundles can use it.
 */
import type { Frame } from '../canvas-file';
import type { Point, Rect } from './viewport';

/** The drag data type a sidebar story row carries; the value is the story id. */
export const STORY_DRAG_TYPE = 'application/x-storybook-story';

/**
 * Frames need an explicit width (drawable children are laid out as blocks). Stories do not say how
 * wide they want to be, so the width follows the story's `layout` parameter: full-page stories get a
 * small desktop width, components a narrower one.
 */
export const FRAME_WIDTHS = { fullscreen: 960, padded: 480, centered: 360 } as const;

/** Height assumed for a frame whose height is not known yet (same as the MCP summaries use). */
export const ASSUMED_FRAME_HEIGHT = 400;

export const MIN_FRAME_WIDTH = 120;
export const MIN_FRAME_HEIGHT = 40;
export const MAX_FRAME_SIZE = 4000;

/** Gap between frames placed by "Add to canvas". */
export const FRAME_GAP = 80;

export type StoryLayout = keyof typeof FRAME_WIDTHS;

export function storyLayout(parameters: Record<string, unknown> | undefined): StoryLayout {
  const layout = parameters?.layout;
  return layout === 'fullscreen' || layout === 'centered' ? layout : 'padded';
}

export function defaultFrameWidth(parameters: Record<string, unknown> | undefined): number {
  return FRAME_WIDTHS[storyLayout(parameters)];
}

export function clampFrameSize(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.min(MAX_FRAME_SIZE, Math.max(min, value)));
}

/**
 * A frame as the board shows it: at least the minimum size, whatever the file says. The resize
 * handles already keep to these minimums; a hand-edited or agent-written file may not (a 1px-wide
 * frame could not be seen or grabbed). The file is left as it is until the frame is resized.
 */
export function withMinimumSize<F extends Pick<Frame, 'width' | 'height'>>(frame: F): F {
  const width = Math.max(MIN_FRAME_WIDTH, frame.width);
  const height = frame.height === undefined ? undefined : Math.max(MIN_FRAME_HEIGHT, frame.height);
  if (width === frame.width && height === frame.height) return frame;
  const next = { ...frame, width };
  if (height !== undefined) next.height = height;
  return next;
}

/**
 * The frame to put back when a removal is undone: the frame as shown (its place, and any size the
 * user gave it), but with the file's own size when the shown size is only the file's size with the
 * minimums applied. An undersized frame from a hand edit comes back exactly as it was in the file.
 */
export function frameToRestore(shown: Frame, file: Frame | undefined): Frame {
  if (!file || file.id !== shown.id) return shown;
  const minimum = withMinimumSize(file);
  if (minimum.width !== shown.width || minimum.height !== shown.height) return shown;
  if (file.width === shown.width && file.height === shown.height) return shown;
  const restored: Frame = { ...shown, width: file.width };
  if (file.height === undefined) delete restored.height;
  else restored.height = file.height;
  return restored;
}

/** Store coordinates are whole CSS pixels; keeps files tidy and diffs small. */
export function roundPoint(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

/** A frame's rectangle in world coordinates, using its stored height or the assumed one. */
export function frameRect(frame: Pick<Frame, 'x' | 'y' | 'width' | 'height'>, measuredHeight?: number): Rect {
  return {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: measuredHeight ?? frame.height ?? ASSUMED_FRAME_HEIGHT,
  };
}

/**
 * Where "Add to canvas" puts a new frame: to the right of everything on the canvas, top-aligned
 * with the topmost frame, or at the origin on an empty canvas.
 */
export function nextFramePosition(frames: readonly Pick<Frame, 'x' | 'y' | 'width' | 'height'>[]): Point {
  if (frames.length === 0) return { x: 0, y: 0 };
  let right = -Infinity;
  let top = Infinity;
  for (const frame of frames) {
    right = Math.max(right, frame.x + frame.width);
    top = Math.min(top, frame.y);
  }
  return roundPoint({ x: right + FRAME_GAP, y: top });
}
