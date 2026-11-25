/**
 * Where comment pins go and how comments are listed. Pure, so it runs in Node tests; the DOM side
 * (finding an element's offset in its frame) is in `src/canvas-page/board/comment-dom.ts`.
 *
 * A pin's world point comes from its anchor:
 * - `position`: the point itself (negative coordinates are fine; the board is unbounded);
 * - `frame`: the frame's top-left corner plus the anchor's `x`/`y` offset (the corner without one);
 * - `element`: the element's top-right corner inside its frame. When the element cannot be found
 *   the pin falls back to the frame's corner and is `detached`.
 * An anchor whose frame is no longer on the canvas has no place on the board (`orphan`); the comment
 * still shows in the list.
 */
import type { Anchor, Comment, ElementTarget } from '../canvas-file';
import type { Point, Rect } from './viewport';

export interface PinFrame {
  id: string;
  x: number;
  y: number;
  width: number;
}

/**
 * How an element anchor resolved in its frame: an offset (world units, from the frame's top-left),
 * `detached` (the element is not there), or `pending` (the story has not rendered yet).
 */
export type ElementOffset = { kind: 'offset'; offset: Point } | { kind: 'detached' } | { kind: 'pending' };

export type PinPlacement =
  | { state: 'attached' | 'detached' | 'pending'; point: Point; frameId?: string }
  | { state: 'orphan'; frameId: string };

/** The frame an anchor belongs to, if any. */
export function anchorFrameId(anchor: Anchor): string | undefined {
  return anchor.type === 'position' ? undefined : anchor.frameId;
}

/** The story an anchor is about, if any (it survives the frame's removal). */
export function anchorStoryId(anchor: Anchor): string | undefined {
  if (anchor.type === 'element') return anchor.target.storyId;
  if (anchor.type === 'frame') return anchor.storyId;
  return undefined;
}

export function pinPlacement(
  anchor: Anchor,
  frames: ReadonlyMap<string, PinFrame>,
  elementOffset: (anchor: Extract<Anchor, { type: 'element' }>) => ElementOffset,
): PinPlacement {
  if (anchor.type === 'position') return { state: 'attached', point: { x: anchor.x, y: anchor.y } };
  const frame = frames.get(anchor.frameId);
  if (!frame) return { state: 'orphan', frameId: anchor.frameId };
  if (anchor.type === 'frame') {
    return {
      state: 'attached',
      point: { x: frame.x + (anchor.x ?? 0), y: frame.y + (anchor.y ?? 0) },
      frameId: frame.id,
    };
  }
  const resolved = elementOffset(anchor);
  if (resolved.kind === 'offset') {
    return {
      state: 'attached',
      point: { x: frame.x + resolved.offset.x, y: frame.y + resolved.offset.y },
      frameId: frame.id,
    };
  }
  return { state: resolved.kind, point: { x: frame.x, y: frame.y }, frameId: frame.id };
}

/**
 * World boxes of the open comments' pins that can lie outside every frame, for zoom to fit:
 * `position` anchors and `frame` anchors with an offset (an element pin sits on its element, inside
 * its frame, and a pin at a frame's corner is inside it too). A pin is drawn above and to the right
 * of its point, `pinSize` world units square (zoom 1); fitting at a smaller zoom only adds margin.
 */
export function pinBounds(
  comments: readonly Comment[],
  frames: ReadonlyMap<string, PinFrame>,
  pinSize: number,
): Rect[] {
  return comments.flatMap((comment) => {
    if (comment.status !== 'open') return [];
    const { anchor } = comment;
    if (anchor.type === 'element' || (anchor.type === 'frame' && anchor.x === undefined)) return [];
    const placement = pinPlacement(anchor, frames, () => ({ kind: 'pending' }));
    if (placement.state === 'orphan') return [];
    return [{ x: placement.point.x, y: placement.point.y - pinSize, width: pinSize, height: pinSize }];
  });
}

/**
 * Pins that land on the same spot (several comments on one anchor, or on one element) stack: each
 * gets its index within its spot, so the board can fan them out. Keys are rounded world points.
 */
export function stackIndexes(pins: readonly { id: string; point: Point }[]): Map<string, number> {
  const counts = new Map<string, number>();
  const indexes = new Map<string, number>();
  for (const pin of pins) {
    const key = `${Math.round(pin.point.x)}:${Math.round(pin.point.y)}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    indexes.set(pin.id, index);
  }
  return indexes;
}

/** Open comments first, then resolved; oldest first within each. */
export function sortComments(comments: readonly Comment[]): Comment[] {
  return [...comments].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function quoteText(value: string, max = 40): string {
  const text = value.length > max ? `${value.slice(0, max - 1)}…` : value;
  return `“${text}”`;
}

/** A short description of an element target: `button “Log in”`, `img “Logo”`, `h1`. */
export function describeTarget(target: Pick<ElementTarget, 'html' | 'role' | 'name' | 'text'>): string {
  const tag = /^<([a-zA-Z][\w-]*)/.exec(target.html)?.[1]?.toLowerCase();
  const kind = target.role ?? tag ?? 'element';
  const label = target.name ?? (target.text || undefined);
  return label ? `${kind} ${quoteText(label)}` : kind;
}

/** What a comment is about, in a few words, for the list and the thread header. */
export function describeAnchor(anchor: Anchor, storyName: (storyId: string) => string): string {
  if (anchor.type === 'position') return 'On the canvas';
  if (anchor.type === 'frame') return storyName(anchor.storyId);
  return `${describeTarget(anchor.target)} in ${storyName(anchor.target.storyId)}`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", or the date. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.max(0, (now.getTime() - then.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)} d ago`;
  return then.toISOString().slice(0, 10);
}
