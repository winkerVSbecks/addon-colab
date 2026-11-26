/**
 * Which keys the board acts on, decided by where the keyboard focus is.
 *
 * Stories on the board are live, so most keys belong to them. The board only acts on a key when
 * focus is on its own chrome: a frame's title (Delete/Backspace removes that frame) or the board
 * itself (Escape deselects, from a title too). A press inside a story selects its frame for show,
 * but focus then sits on the board root or on an element of the story, never on the title, so
 * Backspace there cannot remove anything.
 *
 * Pure functions over a minimal element shape, so they run in Node tests without a DOM.
 */

import { type BoardMode, modeForKey } from './modes';

/** The parts of a DOM element these rules read. */
export interface FocusElement {
  tagName: string;
  isContentEditable?: boolean;
  /** For `<input>`: its type. */
  type?: string;
  hasAttribute: (name: string) => boolean;
  closest: (selector: string) => unknown;
}

/**
 * Where the focus is, from the board's point of view:
 * - `none`: nothing in particular (the page body, or no element);
 * - `text`: a text field anywhere (keys are typing);
 * - `story`: an element inside a story frame (keys belong to the story);
 * - `frame-title`: a frame's title on the board's chrome;
 * - `board`: the board's root element (after a press on empty space, a pan or inside a story's
 *   plain text);
 * - `control`: any other element, such as a toolbar button.
 */
export type FocusPlace = 'none' | 'text' | 'story' | 'frame-title' | 'board' | 'control';

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** Whether keyboard input on this element is text entry rather than shortcuts. */
export function isTextEntry(element: FocusElement | null | undefined): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((element.type ?? 'text').toLowerCase());
  return false;
}

export function focusPlace(element: FocusElement | null | undefined): FocusPlace {
  if (!element) return 'none';
  const tag = element.tagName.toUpperCase();
  if (tag === 'BODY' || tag === 'HTML') return 'none';
  if (isTextEntry(element)) return 'text';
  if (element.closest('[data-colab-frame]')) return 'story';
  if (element.closest('[data-colab-frame-title]')) return 'frame-title';
  if (element.hasAttribute('data-colab-board')) return 'board';
  return 'control';
}

/** The parts of a keyboard event these rules read. */
export interface KeyLike {
  key: string;
  defaultPrevented?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * - `deselect`: clear the frame selection.
 * - `undo` / `redo`: the board's undo stack (`src/board/undo-stack.ts`).
 * - `exit-mode`: back to the `select` mode.
 * - `mode:<mode>`: switch to that mode (single-key shortcut).
 */
export type BoardKeyAction = 'deselect' | 'undo' | 'redo' | 'exit-mode' | `mode:${BoardMode}` | null;

export interface BoardKeyState {
  hasSelection: boolean;
  /** The undo stack has something to undo. */
  canUndo?: boolean;
  /** The undo stack has something to redo. */
  canRedo?: boolean;
  /** The current board mode (default `select`). */
  mode?: BoardMode;
  /** The modes the board offers (shortcuts for other modes are ignored). Default: none. */
  modes?: readonly BoardMode[];
}

/** Places where the board's undo keys act: never in a text field or a story (they have their own). */
function undoKeysApply(place: FocusPlace): boolean {
  return place !== 'text' && place !== 'story';
}

/**
 * What a key pressed anywhere in the preview does to the board. This is the only board-level key
 * handler; every board shortcut is decided here. Frame removal is not here: only a frame's title
 * removes its frame (see `titleKeyAction`).
 * - ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redoes, unless the key belongs to a text field
 *   or a story.
 * - Escape leaves a comment or draw mode (from the board, a title, a control or nowhere), otherwise
 *   deselects (from the board, a title or nowhere).
 * - V, C and D switch mode, only with focus on the board itself or nowhere.
 */
export function boardKeyAction(event: KeyLike, place: FocusPlace, state: BoardKeyState): BoardKeyAction {
  if (event.defaultPrevented) return null;
  const key = event.key.toLowerCase();
  const command = event.metaKey || event.ctrlKey;
  if (command && !event.altKey && undoKeysApply(place)) {
    const isUndo = key === 'z' && !event.shiftKey;
    const isRedo =
      (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey);
    if (isUndo && state.canUndo) return 'undo';
    if (isRedo && state.canRedo) return 'redo';
    return null;
  }
  const mode = state.mode ?? 'select';
  if (event.key === 'Escape') {
    if (mode !== 'select' && place !== 'text' && place !== 'story') return 'exit-mode';
    if (state.hasSelection && (place === 'board' || place === 'frame-title' || place === 'none')) return 'deselect';
    return null;
  }
  if (!command && !event.altKey && !event.shiftKey && (place === 'board' || place === 'none')) {
    const next = modeForKey(event.key, state.modes ?? []);
    if (next && next !== mode) return `mode:${next}`;
  }
  return null;
}

export type TitleKeyAction = { type: 'nudge'; dx: number; dy: number } | { type: 'remove' } | { type: 'select' } | null;

/** What a key does while a frame's title has focus. */
export function titleKeyAction(event: KeyLike): TitleKeyAction {
  const step = event.shiftKey ? 10 : 1;
  switch (event.key) {
    case 'ArrowLeft':
      return { type: 'nudge', dx: -step, dy: 0 };
    case 'ArrowRight':
      return { type: 'nudge', dx: step, dy: 0 };
    case 'ArrowUp':
      return { type: 'nudge', dx: 0, dy: -step };
    case 'ArrowDown':
      return { type: 'nudge', dx: 0, dy: step };
    case 'Delete':
    case 'Backspace':
      return { type: 'remove' };
    case 'Enter':
    case ' ':
      return { type: 'select' };
    default:
      return null;
  }
}

/**
 * Whether holding Space starts panning. Only when focus is on the board itself (or nowhere):
 * anywhere else Space belongs to the focused element, such as a button or checkbox in a story, a
 * frame's title or a toolbar button.
 */
export function spaceStartsPan(place: FocusPlace): boolean {
  return place === 'board' || place === 'none';
}
