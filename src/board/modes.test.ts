import { describe, expect, it } from 'vitest';

import { BOARD_MODES, MODE_SHORTCUTS, modeCatchesPresses, modeForKey, pressBelongsToMode } from './modes';

describe('board modes', () => {
  it('select lets presses through; comment and draw catch them', () => {
    expect(modeCatchesPresses('select')).toBe(false);
    expect(modeCatchesPresses('comment')).toBe(true);
    expect(modeCatchesPresses('draw')).toBe(true);
  });

  it('a catching mode takes left-button presses, not the middle button or a Space drag (those pan)', () => {
    expect(pressBelongsToMode('comment', 0, false)).toBe(true);
    expect(pressBelongsToMode('comment', 1, false)).toBe(false);
    expect(pressBelongsToMode('draw', 0, true)).toBe(false);
    expect(pressBelongsToMode('select', 0, false)).toBe(false);
  });

  it('maps shortcut keys to available modes only', () => {
    expect(modeForKey('C', BOARD_MODES)).toBe('comment');
    expect(modeForKey('v', BOARD_MODES)).toBe('select');
    expect(modeForKey('d', ['select'])).toBeNull();
    expect(modeForKey('x', BOARD_MODES)).toBeNull();
  });

  it('has one distinct shortcut per mode', () => {
    expect(new Set(Object.values(MODE_SHORTCUTS)).size).toBe(BOARD_MODES.length);
  });
});
