/**
 * Board modes: what a press on the board does.
 *
 * - `select` (the default): stories are live; presses reach them, select and raise their frame,
 *   and drag the empty background to pan.
 * - `comment`: a press pins a comment (to the element under the pointer, or to the canvas).
 * - `draw`: a press draws a stroke.
 *
 * In any mode other than `select`, a layer over the frames catches every left-button press before
 * the stories, selection, raising and pan see it (see `ModeLayer`). The middle button, Space-drag
 * and the wheel still pan and zoom. Escape goes back to `select`.
 *
 * Pure, so it runs in Node tests.
 */

export type BoardMode = 'select' | 'comment' | 'draw';

/** The order of the mode switcher. */
export const BOARD_MODES: readonly BoardMode[] = ['select', 'comment', 'draw'];

export const MODE_LABELS: Record<BoardMode, string> = {
  select: 'Select and interact',
  comment: 'Comment',
  draw: 'Draw',
};

/** Single-key shortcuts (only while focus is on the board itself, see `keyboard.ts`). */
export const MODE_SHORTCUTS: Record<BoardMode, string> = {
  select: 'v',
  comment: 'c',
  draw: 'd',
};

/** The mode a shortcut key selects, if it is one of the available modes. */
export function modeForKey(key: string, available: readonly BoardMode[]): BoardMode | null {
  const lower = key.toLowerCase();
  const mode = BOARD_MODES.find((candidate) => MODE_SHORTCUTS[candidate] === lower);
  return mode && available.includes(mode) ? mode : null;
}

/** Whether the mode layer catches presses (everything but `select`). */
export function modeCatchesPresses(mode: BoardMode): boolean {
  return mode !== 'select';
}

/**
 * Whether a press in a catching mode belongs to the mode (rather than to pan): left button only,
 * and not while Space is held.
 */
export function pressBelongsToMode(mode: BoardMode, button: number, spaceHeld: boolean): boolean {
  return modeCatchesPresses(mode) && button === 0 && !spaceHeld;
}
