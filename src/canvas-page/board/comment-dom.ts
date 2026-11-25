/**
 * The DOM side of comments on the board: what is under the pointer, where an element sits inside
 * its frame, and the story facts an element target needs.
 *
 * Story nodes live inside the board's `<canvas>` (HTML-in-Canvas); their `getBoundingClientRect()`
 * and `elementsFromPoint` report where they are drawn, so hit testing works on what the user sees,
 * at any zoom and with frames stacked in their drawn order.
 */
import { type TargetStory, pickTarget, resolveTarget } from '../../board/element-target';
import type { ElementOffset } from '../../board/comment-pins';
import type { ElementTarget } from '../../canvas-file';
import type { PreviewLike } from './story-mount';

/** Marks the element a story renders into (set by FrameBody); selectors are relative to it. */
export const STORY_ROOT_ATTRIBUTE = 'data-colab-story-root';

export interface StoryHit {
  frameId: string;
  /** The frame body (`[data-colab-frame]`). */
  frame: HTMLElement;
  /** The story root inside it. */
  root: HTMLElement;
  /** The element the user means (see `pickTarget`), or null for the story's empty area. */
  element: Element | null;
}

/** The story element under a viewport point, ignoring the board's own layers above the stories. */
export function storyHitAt(doc: Document, clientX: number, clientY: number, { exact = false } = {}): StoryHit | null {
  for (const hit of doc.elementsFromPoint(clientX, clientY)) {
    const frame = hit.closest<HTMLElement>('[data-colab-frame]');
    if (!frame) continue;
    const frameId = frame.getAttribute('data-colab-frame');
    const root = frame.querySelector<HTMLElement>(`[${STORY_ROOT_ATTRIBUTE}]`);
    if (!frameId || !root) return null;
    return { frameId, frame, root, element: pickTarget(hit, root, { exact }) };
  }
  return null;
}

export function frameElement(doc: Document, frameId: string): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[data-colab-frame="${CSS.escape(frameId)}"]`);
}

export function storyRootOf(frame: HTMLElement): HTMLElement | null {
  return frame.querySelector<HTMLElement>(`[${STORY_ROOT_ATTRIBUTE}]`);
}

/** The drawn scale of a frame (drawn width / world width), or 0 while it is not drawn. */
function drawnScale(frame: HTMLElement, worldWidth: number): number {
  const rect = frame.getBoundingClientRect();
  return worldWidth > 0 && rect.width > 0 ? rect.width / worldWidth : 0;
}

/**
 * Where an element's pin goes, as a world offset from its frame's top-left: the element's top-right
 * corner, kept inside the frame. Measured against the frame's own drawn rect, so it holds at any
 * zoom and wherever the frame was last drawn.
 */
export function pinOffsetInFrame(element: Element, frame: HTMLElement, worldWidth: number): ElementOffset {
  const scale = drawnScale(frame, worldWidth);
  if (!scale) return { kind: 'pending' };
  const frameRect = frame.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return { kind: 'detached' };
  const x = Math.min((rect.right - frameRect.left) / scale, worldWidth);
  const y = Math.max(0, (rect.top - frameRect.top) / scale);
  return { kind: 'offset', offset: { x: Math.max(0, x), y } };
}

/** Resolves an element target inside its frame (selector, then role + name), as a pin offset. */
export function resolveElementOffset(
  doc: Document,
  frameId: string,
  worldWidth: number,
  target: ElementTarget,
): ElementOffset {
  const frame = frameElement(doc, frameId);
  const root = frame && storyRootOf(frame);
  if (!frame || !root) return { kind: 'pending' };
  // An empty root: the story has not rendered (yet), so nothing can be called detached.
  if (!root.firstElementChild) return { kind: 'pending' };
  const resolved = resolveTarget(root, target);
  if (resolved.kind === 'detached') return { kind: 'detached' };
  return pinOffsetInFrame(resolved.element, frame, worldWidth);
}

/** The element an element target points at now, if it can be found. */
export function findTargetElement(doc: Document, frameId: string, target: ElementTarget): Element | null {
  const frame = frameElement(doc, frameId);
  const root = frame && storyRootOf(frame);
  if (!root) return null;
  const resolved = resolveTarget(root, target);
  return resolved.kind === 'found' ? resolved.element : null;
}

/** A world-space offset of a viewport point from a frame's top-left (for frame anchors). */
export function pointInFrame(frame: HTMLElement, worldWidth: number, clientX: number, clientY: number) {
  const scale = drawnScale(frame, worldWidth) || 1;
  const rect = frame.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round((clientX - rect.left) / scale)),
    y: Math.max(0, Math.round((clientY - rect.top) / scale)),
  };
}

/** Story id, title and story file for a target, from the preview (the file is `parameters.fileName`). */
export async function targetStory(preview: PreviewLike, storyId: string): Promise<TargetStory> {
  const story = await preview.loadStory({ storyId });
  const fileName = story.parameters?.fileName;
  let importPath = typeof fileName === 'string' && fileName ? fileName : undefined;
  if (!importPath) {
    // Fallback: the index Storybook serves next to the preview.
    try {
      const index = (await (await fetch('./index.json')).json()) as {
        entries?: Record<string, { importPath?: string }>;
      };
      importPath = index.entries?.[storyId]?.importPath;
    } catch {
      // Leave it unknown.
    }
  }
  return { storyId, title: story.title, importPath: importPath ?? 'unknown' };
}
