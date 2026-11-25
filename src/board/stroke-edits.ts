/**
 * Stroke changes made on this board, shown at once and kept on top of the canvas file until the
 * file has caught up, so a stroke never blinks out between pointer up and the store's change event,
 * and an erased stroke never blinks back. Remote changes (another tab, the agent, a hand edit) show
 * through untouched.
 *
 * - `added`: strokes drawn (or put back by undo/redo) here, shown until the file has their id.
 * - `removed`: stroke ids erased here, hidden until the write is done and the file no longer has them.
 *
 * Pure, so it runs in Node tests; `use-strokes.ts` holds it in React state.
 */
import type { Stroke } from '../canvas-file';

export interface StrokeEdits {
  added: ReadonlyMap<string, Stroke>;
  /** Erased id → whether its write has finished. */
  removed: ReadonlyMap<string, boolean>;
}

export const NO_STROKE_EDITS: StrokeEdits = { added: new Map(), removed: new Map() };

/** The strokes to draw: the file's, minus the ones erased here, plus the ones added here and not yet in the file. */
export function visibleStrokes(file: readonly Stroke[], edits: StrokeEdits): Stroke[] {
  if (edits.added.size === 0 && edits.removed.size === 0) return file as Stroke[];
  const inFile = new Set(file.map((stroke) => stroke.id));
  const shown = file.filter((stroke) => !edits.removed.has(stroke.id));
  for (const stroke of edits.added.values()) {
    if (!inFile.has(stroke.id) && !edits.removed.has(stroke.id)) shown.push(stroke);
  }
  return shown;
}

/** Forgets edits the file has caught up with. Returns `edits` itself when nothing changed. */
export function settleStrokeEdits(edits: StrokeEdits, file: readonly Stroke[]): StrokeEdits {
  const inFile = new Set(file.map((stroke) => stroke.id));
  let added: Map<string, Stroke> | undefined;
  for (const id of edits.added.keys()) {
    if (inFile.has(id)) (added ??= new Map(edits.added)).delete(id);
  }
  let removed: Map<string, boolean> | undefined;
  for (const [id, done] of edits.removed) {
    if (done && !inFile.has(id)) (removed ??= new Map(edits.removed)).delete(id);
  }
  if (!added && !removed) return edits;
  return { added: added ?? edits.added, removed: removed ?? edits.removed };
}

export function withAdded(edits: StrokeEdits, stroke: Stroke): StrokeEdits {
  const removed = new Map(edits.removed);
  removed.delete(stroke.id);
  return { added: new Map(edits.added).set(stroke.id, stroke), removed };
}

/** Replaces a stroke shown under a temporary id by the saved one (the store gave it its real id). */
export function withSaved(edits: StrokeEdits, temporaryId: string, saved: Stroke): StrokeEdits {
  const added = new Map(edits.added);
  added.delete(temporaryId);
  // Erased before its save finished: keep it hidden under its real id; the caller removes it next.
  if (edits.removed.has(temporaryId)) {
    const removed = new Map(edits.removed);
    removed.delete(temporaryId);
    removed.set(saved.id, false);
    return { added, removed };
  }
  added.set(saved.id, saved);
  return { added, removed: edits.removed };
}

export function withoutAdded(edits: StrokeEdits, id: string): StrokeEdits {
  if (!edits.added.has(id)) return edits;
  const added = new Map(edits.added);
  added.delete(id);
  return { added, removed: edits.removed };
}

/** Hides strokes while they are being erased. */
export function withRemoved(edits: StrokeEdits, ids: readonly string[]): StrokeEdits {
  const removed = new Map(edits.removed);
  for (const id of ids) removed.set(id, false);
  return { added: edits.added, removed };
}

/** The erase write finished (`ok`) or failed, in which case the stroke shows again. */
export function withRemoveDone(edits: StrokeEdits, ids: readonly string[], ok: boolean): StrokeEdits {
  const removed = new Map(edits.removed);
  for (const id of ids) {
    if (!removed.has(id)) continue;
    if (ok) removed.set(id, true);
    else removed.delete(id);
  }
  return { added: edits.added, removed };
}
