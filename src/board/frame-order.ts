/**
 * Stacking order of frames. The order of `frames` in the canvas file is the stacking order: the
 * last frame is drawn last, so it is on top and gets the pointer where frames overlap. Selecting a
 * frame brings it to the front, which moves it to the end of the list (store op `raiseFrame`).
 *
 * The board shows the new order at once and keeps it until the file agrees.
 */

interface HasId {
  id: string;
}

export function isOnTop(frames: readonly HasId[], frameId: string): boolean {
  return frames.at(-1)?.id === frameId;
}

/** `frames` with `raisedId` moved to the end. The same array when there is nothing to move. */
export function withRaised<F extends HasId>(frames: readonly F[], raisedId: string | null): readonly F[] {
  if (raisedId === null || isOnTop(frames, raisedId)) return frames;
  const raised = frames.find((frame) => frame.id === raisedId);
  if (!raised) return frames;
  return [...frames.filter((frame) => frame.id !== raisedId), raised];
}

/**
 * Whether a local raise can be forgotten: the file has the frame on top, or no longer has it.
 */
export function raiseSettled(fileFrames: readonly HasId[], raisedId: string): boolean {
  return isOnTop(fileFrames, raisedId) || !fileFrames.some((frame) => frame.id === raisedId);
}

/**
 * The frames in an order that does not depend on stacking (by id). The board keeps its DOM in this
 * order: moving a DOM node drops its focus and pointer capture, and a press is what raises a frame.
 */
export function inStableOrder<F extends HasId>(frames: readonly F[]): F[] {
  return [...frames].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
