import { describe, expect, it } from 'vitest';

import { type FocusElement, boardKeyAction, focusPlace, isTextEntry, spaceStartsPan, titleKeyAction } from './keyboard';

/**
 * A stand-in element. `inside` lists the attribute selectors it (or an ancestor) matches; `own`
 * lists attributes on the element itself.
 */
function el(tagName: string, options: { inside?: string[]; own?: string[]; type?: string; editable?: boolean } = {}) {
  const own = options.own ?? [];
  const inside = [...(options.inside ?? []), ...own.map((name) => `[${name}]`)];
  return {
    tagName,
    type: options.type,
    isContentEditable: options.editable ?? false,
    hasAttribute: (name: string) => own.includes(name),
    closest: (selector: string) => (inside.includes(selector) ? {} : null),
  } satisfies FocusElement;
}

const board = el('DIV', { own: ['data-colab-board'] });
const storyHeading = el('H2', { inside: ['[data-colab-frame]', '[data-colab-board]'] });
const storyButton = el('BUTTON', { inside: ['[data-colab-frame]', '[data-colab-board]'] });
const storyInput = el('INPUT', { type: 'text', inside: ['[data-colab-frame]'] });
const title = el('BUTTON', { own: ['data-colab-frame-title'], inside: ['[data-colab-board]'] });
const toolbarButton = el('BUTTON', { inside: ['[data-colab-board]'] });

describe('focusPlace', () => {
  it('tells the board, a frame title, a story and other controls apart', () => {
    expect(focusPlace(board)).toBe('board');
    expect(focusPlace(title)).toBe('frame-title');
    expect(focusPlace(storyHeading)).toBe('story');
    expect(focusPlace(storyButton)).toBe('story');
    expect(focusPlace(toolbarButton)).toBe('control');
  });

  it('treats text fields as typing, wherever they are', () => {
    expect(focusPlace(storyInput)).toBe('text');
    expect(focusPlace(el('TEXTAREA'))).toBe('text');
    expect(focusPlace(el('DIV', { editable: true }))).toBe('text');
  });

  it('treats the body or no element as nothing in particular', () => {
    expect(focusPlace(null)).toBe('none');
    expect(focusPlace(el('BODY'))).toBe('none');
  });
});

describe('isTextEntry', () => {
  it('counts text-like inputs, not buttons, checkboxes or ranges', () => {
    expect(isTextEntry(el('INPUT'))).toBe(true);
    expect(isTextEntry(el('INPUT', { type: 'search' }))).toBe(true);
    expect(isTextEntry(el('INPUT', { type: 'email' }))).toBe(true);
    expect(isTextEntry(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTextEntry(el('INPUT', { type: 'range' }))).toBe(false);
    expect(isTextEntry(el('INPUT', { type: 'submit' }))).toBe(false);
    expect(isTextEntry(el('SELECT'))).toBe(true);
    expect(isTextEntry(el('BUTTON'))).toBe(false);
  });
});

describe('Delete and Backspace', () => {
  it('never act at board level, so a press inside a story cannot remove its frame', () => {
    // Clicking plain text in a story leaves focus on the board root; clicking a button focuses it.
    for (const place of ['board', 'story', 'none', 'control', 'text'] as const) {
      expect(boardKeyAction({ key: 'Backspace' }, place, { hasSelection: true })).toBeNull();
      expect(boardKeyAction({ key: 'Delete' }, place, { hasSelection: true })).toBeNull();
    }
    expect(focusPlace(storyHeading)).not.toBe('frame-title');
  });

  it('remove the frame only from its own title', () => {
    expect(titleKeyAction({ key: 'Backspace' })).toEqual({ type: 'remove' });
    expect(titleKeyAction({ key: 'Delete' })).toEqual({ type: 'remove' });
  });
});

describe('Escape', () => {
  it('deselects from the board or a title, not from inside a story or a control', () => {
    expect(boardKeyAction({ key: 'Escape' }, 'board', { hasSelection: true })).toBe('deselect');
    expect(boardKeyAction({ key: 'Escape' }, 'none', { hasSelection: true })).toBe('deselect');
    expect(boardKeyAction({ key: 'Escape' }, 'frame-title', { hasSelection: true })).toBe('deselect');
    expect(boardKeyAction({ key: 'Escape' }, 'story', { hasSelection: true })).toBeNull();
    expect(boardKeyAction({ key: 'Escape' }, 'text', { hasSelection: true })).toBeNull();
    expect(boardKeyAction({ key: 'Escape' }, 'board', { hasSelection: false })).toBeNull();
    expect(boardKeyAction({ key: 'Escape', defaultPrevented: true }, 'board', { hasSelection: true })).toBeNull();
  });
});

describe('title keys', () => {
  it('nudge by 1px, or 10px with Shift, and select with Enter or Space', () => {
    expect(titleKeyAction({ key: 'ArrowLeft' })).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(titleKeyAction({ key: 'ArrowDown', shiftKey: true })).toEqual({ type: 'nudge', dx: 0, dy: 10 });
    expect(titleKeyAction({ key: 'Enter' })).toEqual({ type: 'select' });
    expect(titleKeyAction({ key: ' ' })).toEqual({ type: 'select' });
    expect(titleKeyAction({ key: 'a' })).toBeNull();
  });
});

describe('Space', () => {
  it('pans only when focus is on the board itself', () => {
    expect(spaceStartsPan(focusPlace(board))).toBe(true);
    expect(spaceStartsPan(focusPlace(null))).toBe(true);
  });

  it('reaches buttons and other controls inside stories', () => {
    expect(spaceStartsPan(focusPlace(storyButton))).toBe(false);
    expect(spaceStartsPan(focusPlace(el('INPUT', { type: 'checkbox', inside: ['[data-colab-frame]'] })))).toBe(false);
    expect(spaceStartsPan(focusPlace(el('A', { inside: ['[data-colab-frame]'] })))).toBe(false);
    expect(spaceStartsPan(focusPlace(storyInput))).toBe(false);
  });

  it("reaches the board's own controls", () => {
    expect(spaceStartsPan(focusPlace(title))).toBe(false);
    expect(spaceStartsPan(focusPlace(toolbarButton))).toBe(false);
  });
});

describe('⌘Z', () => {
  const undo = { key: 'z', metaKey: true };

  it('undoes a removal while it can be undone, from the board or its controls', () => {
    for (const place of ['board', 'none', 'frame-title', 'control'] as const) {
      expect(boardKeyAction(undo, place, { hasSelection: false, canUndo: true })).toBe('undo');
    }
    expect(boardKeyAction({ key: 'z', ctrlKey: true }, 'board', { hasSelection: false, canUndo: true })).toBe('undo');
    expect(boardKeyAction({ key: 'Z', metaKey: true }, 'board', { hasSelection: false, canUndo: true })).toBe('undo');
  });

  it('is left alone when there is nothing to undo, in text fields and inside stories', () => {
    expect(boardKeyAction(undo, 'board', { hasSelection: true })).toBeNull();
    expect(boardKeyAction(undo, 'text', { hasSelection: false, canUndo: true })).toBeNull();
    expect(boardKeyAction(undo, 'story', { hasSelection: false, canUndo: true })).toBeNull();
    expect(boardKeyAction({ key: 'z' }, 'board', { hasSelection: false, canUndo: true })).toBeNull();
    expect(
      boardKeyAction({ key: 'z', metaKey: true, shiftKey: true }, 'board', { hasSelection: false, canUndo: true }),
    ).toBeNull();
  });
});

describe('⇧⌘Z (redo)', () => {
  const state = { hasSelection: false, canUndo: true, canRedo: true };

  it('redoes from the board or its controls when there is something to redo', () => {
    for (const place of ['board', 'none', 'frame-title', 'control'] as const) {
      expect(boardKeyAction({ key: 'z', metaKey: true, shiftKey: true }, place, state)).toBe('redo');
    }
    expect(boardKeyAction({ key: 'Z', ctrlKey: true, shiftKey: true }, 'board', state)).toBe('redo');
    expect(boardKeyAction({ key: 'y', ctrlKey: true }, 'board', state)).toBe('redo');
  });

  it('is left alone with nothing to redo, in text fields and inside stories', () => {
    expect(
      boardKeyAction({ key: 'z', metaKey: true, shiftKey: true }, 'board', { hasSelection: false, canUndo: true }),
    ).toBeNull();
    expect(boardKeyAction({ key: 'z', metaKey: true, shiftKey: true }, 'text', state)).toBeNull();
    expect(boardKeyAction({ key: 'z', metaKey: true, shiftKey: true }, 'story', state)).toBeNull();
    // ⌘Y is not redo on macOS (it is "show history" in some browsers).
    expect(boardKeyAction({ key: 'y', metaKey: true }, 'board', state)).toBeNull();
  });
});

describe('modes', () => {
  const modes = ['select', 'comment', 'draw'] as const;

  it('Escape leaves a non-select mode before it deselects', () => {
    for (const place of ['board', 'none', 'frame-title', 'control'] as const) {
      expect(boardKeyAction({ key: 'Escape' }, place, { hasSelection: true, mode: 'comment', modes })).toBe(
        'exit-mode',
      );
    }
    expect(boardKeyAction({ key: 'Escape' }, 'board', { hasSelection: true, mode: 'select', modes })).toBe('deselect');
  });

  it('Escape in a text field or a story belongs to them, even in a mode', () => {
    expect(boardKeyAction({ key: 'Escape' }, 'text', { hasSelection: false, mode: 'comment', modes })).toBeNull();
    expect(boardKeyAction({ key: 'Escape' }, 'story', { hasSelection: false, mode: 'draw', modes })).toBeNull();
  });

  it('V, C and D switch mode only with focus on the board or nowhere', () => {
    expect(boardKeyAction({ key: 'c' }, 'board', { hasSelection: false, modes })).toBe('mode:comment');
    expect(boardKeyAction({ key: 'D' }, 'none', { hasSelection: false, modes })).toBe('mode:draw');
    expect(boardKeyAction({ key: 'v' }, 'board', { hasSelection: false, mode: 'comment', modes })).toBe('mode:select');
    for (const place of ['story', 'text', 'frame-title', 'control'] as const) {
      expect(boardKeyAction({ key: 'c' }, place, { hasSelection: false, modes })).toBeNull();
    }
  });

  it('ignores mode keys with modifiers, for the current mode, or for modes the board does not offer', () => {
    expect(boardKeyAction({ key: 'c', metaKey: true }, 'board', { hasSelection: false, modes })).toBeNull();
    expect(boardKeyAction({ key: 'c', shiftKey: true }, 'board', { hasSelection: false, modes })).toBeNull();
    expect(boardKeyAction({ key: 'c' }, 'board', { hasSelection: false, mode: 'comment', modes })).toBeNull();
    expect(boardKeyAction({ key: 'd' }, 'board', { hasSelection: false, modes: ['select', 'comment'] })).toBeNull();
    expect(boardKeyAction({ key: 'c' }, 'board', { hasSelection: false })).toBeNull();
  });
});
