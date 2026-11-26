/**
 * Local frame edits on top of the canvas file, so moving and resizing feel instant.
 *
 * While a frame is dragged the board shows the local position only; when the drag ends it writes
 * once through the store. The canvas file then changes twice from the board's point of view: the
 * store's change event (which may arrive before or after the write's response) and any remote
 * change in between. An edit therefore stays on top of the file until the file is at least as new
 * as the write that saved it, so neither our own event nor an older remote event can snap the frame
 * back. Edits are keyed by frame id, so a frame removed elsewhere simply loses its edit.
 *
 * Pure data in, data out; the board keeps the map in a ref and re-renders on change.
 */
import type { Frame } from '../canvas-file';

export interface FrameEditChanges {
  x?: number;
  y?: number;
  width?: number;
  /** `null` = size to content. */
  height?: number | null;
  /** A pending removal: the frame is hidden until the file no longer has it. */
  removed?: true;
}

export interface FrameEdit {
  frameId: string;
  changes: FrameEditChanges;
  /** Increases with every new edit of any frame; tells a late response from a newer edit apart. */
  revision: number;
  /**
   * `live` while the pointer is still down, `saving` once written, `saved` when the store has
   * answered with the file's `updatedAt` after the write.
   */
  state: 'live' | 'saving' | 'saved';
  savedAt?: string;
}

export type FrameEdits = ReadonlyMap<string, FrameEdit>;

let revisionCounter = 0;

export function nextRevision(): number {
  revisionCounter += 1;
  return revisionCounter;
}

/** The frames to show: the file's frames with pending edits applied and pending removals hidden. */
export function applyFrameEdits(frames: readonly Frame[], edits: FrameEdits): Frame[] {
  if (edits.size === 0) return [...frames];
  const result: Frame[] = [];
  for (const frame of frames) {
    const edit = edits.get(frame.id);
    if (!edit) {
      result.push(frame);
      continue;
    }
    if (edit.changes.removed) continue;
    const { height, x, y, width } = edit.changes;
    const next: Frame = { ...frame };
    if (x !== undefined) next.x = x;
    if (y !== undefined) next.y = y;
    if (width !== undefined) next.width = width;
    if (height === null) delete next.height;
    else if (height !== undefined) next.height = height;
    result.push(next);
  }
  return result;
}

/** Starts or updates a live (unsaved) edit. Later changes merge into earlier ones of the same frame. */
export function withLiveEdit(edits: FrameEdits, frameId: string, changes: FrameEditChanges): Map<string, FrameEdit> {
  const next = new Map(edits);
  const current = edits.get(frameId);
  const merged = current && current.state === 'live' ? { ...current.changes, ...changes } : changes;
  next.set(frameId, { frameId, changes: merged, revision: nextRevision(), state: 'live' });
  return next;
}

/** Marks the frame's edit as being written. Returns the edit's revision, to match the response. */
export function markSaving(edits: FrameEdits, frameId: string): { edits: Map<string, FrameEdit>; revision?: number } {
  const current = edits.get(frameId);
  if (!current) return { edits: new Map(edits) };
  const next = new Map(edits);
  next.set(frameId, { ...current, state: 'saving' });
  return { edits: next, revision: current.revision };
}

/**
 * The write for `revision` succeeded and the file was then at `updatedAt`. Ignored when a newer
 * edit of the same frame has started since (that edit will be written itself).
 */
export function markSaved(
  edits: FrameEdits,
  frameId: string,
  revision: number,
  updatedAt: string,
): Map<string, FrameEdit> {
  const current = edits.get(frameId);
  const next = new Map(edits);
  if (current && current.revision === revision) next.set(frameId, { ...current, state: 'saved', savedAt: updatedAt });
  return next;
}

/** The write for `revision` failed: drop the edit (unless a newer one replaced it) so the file wins. */
export function dropEdit(edits: FrameEdits, frameId: string, revision?: number): Map<string, FrameEdit> {
  const current = edits.get(frameId);
  const next = new Map(edits);
  if (current && (revision === undefined || current.revision === revision)) next.delete(frameId);
  return next;
}

/**
 * Removes edits the file has caught up with: saved edits whose write is at or before the file's
 * `updatedAt`, and edits of frames that no longer exist in the file (a removal landed, or someone
 * else removed the frame). Returns the same map when nothing changed.
 */
export function settleFrameEdits(edits: FrameEdits, frames: readonly Frame[], updatedAt: string): FrameEdits {
  if (edits.size === 0) return edits;
  const ids = new Set(frames.map((frame) => frame.id));
  let changed = false;
  const next = new Map(edits);
  for (const [frameId, edit] of edits) {
    // ISO timestamps from the store all have the same shape (`…sss Z`), so they compare as strings.
    const caughtUp = edit.state === 'saved' && edit.savedAt !== undefined && updatedAt >= edit.savedAt;
    if (caughtUp || !ids.has(frameId)) {
      next.delete(frameId);
      changed = true;
    }
  }
  return changed ? next : edits;
}
