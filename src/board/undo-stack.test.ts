import { describe, expect, it, vi } from 'vitest';

import { type UndoEntry, UndoStack } from './undo-stack';

function entry(label: string, log: string[], options: { fail?: boolean; redo?: boolean } = {}): UndoEntry {
  return {
    label,
    undo: async () => {
      await Promise.resolve();
      log.push(`undo ${label}`);
      return !options.fail;
    },
    redo:
      options.redo === false
        ? undefined
        : () => {
            log.push(`redo ${label}`);
          },
  };
}

describe('UndoStack', () => {
  it('undoes in reverse order, so a second removal never drops the first', async () => {
    const log: string[] = [];
    const stack = new UndoStack();
    stack.push(entry('a', log));
    stack.push(entry('b', log));
    await stack.undo();
    await stack.undo();
    expect(log).toEqual(['undo b', 'undo a']);
    expect(stack.canUndo).toBe(false);
  });

  it('redoes what was undone, and a new change clears the redo stack', async () => {
    const log: string[] = [];
    const stack = new UndoStack();
    stack.push(entry('a', log));
    await stack.undo();
    expect(stack.canRedo).toBe(true);
    await stack.redo();
    expect(log).toEqual(['undo a', 'redo a']);
    expect(stack.canUndo).toBe(true);
    await stack.undo();
    stack.push(entry('b', log));
    expect(stack.canRedo).toBe(false);
  });

  it('runs undos one at a time, in order, even when started together', async () => {
    const log: string[] = [];
    const stack = new UndoStack();
    let release!: () => void;
    stack.push({ label: 'a', undo: () => log.push('undo a') });
    stack.push({
      label: 'slow',
      undo: () =>
        new Promise<void>((resolve) => {
          release = () => {
            log.push('undo slow');
            resolve();
          };
        }),
    });
    const first = stack.undo();
    const second = stack.undo();
    await Promise.resolve();
    expect(log).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(log).toEqual(['undo slow', 'undo a']);
  });

  it('drops an entry whose undo fails or throws', async () => {
    const log: string[] = [];
    const stack = new UndoStack();
    stack.push(entry('a', log, { fail: true }));
    expect(await stack.undo()).toBeUndefined();
    expect(stack.canRedo).toBe(false);
    stack.push({
      label: 'b',
      undo: () => {
        throw new Error('nope');
      },
    });
    expect(await stack.undo()).toBeUndefined();
    expect(stack.canUndo).toBe(false);
  });

  it('cannot redo an entry without redo', async () => {
    const stack = new UndoStack();
    stack.push(entry('a', [], { redo: false }));
    await stack.undo();
    expect(stack.canRedo).toBe(false);
    expect(await stack.redo()).toBeUndefined();
  });

  it("undoes a notice's own entry even when later changes sit above it", async () => {
    const log: string[] = [];
    const stack = new UndoStack();
    const a = stack.push(entry('a', log));
    const b = stack.push(entry('b', log));
    expect(await stack.undoEntry(a)).toBe(true);
    expect(log).toEqual(['undo a']);
    expect(stack.has(a)).toBe(false);
    expect(stack.has(b)).toBe(true);
    // Undone out of order: not redoable (redo would jump over b).
    expect(stack.canRedo).toBe(false);
    expect(await stack.undoEntry(a)).toBe(false);
  });

  it('keeps at most `limit` entries', async () => {
    const log: string[] = [];
    const stack = new UndoStack(2);
    stack.push(entry('a', log));
    stack.push(entry('b', log));
    stack.push(entry('c', log));
    await stack.undo();
    await stack.undo();
    await stack.undo();
    expect(log).toEqual(['undo c', 'undo b']);
  });

  it('tells subscribers about every change, and clear forgets everything', async () => {
    const stack = new UndoStack();
    const listener = vi.fn();
    const unsubscribe = stack.subscribe(listener);
    stack.push(entry('a', []));
    await stack.undo();
    stack.clear();
    expect(listener).toHaveBeenCalled();
    expect(stack.canUndo || stack.canRedo).toBe(false);
    unsubscribe();
    listener.mockClear();
    stack.push(entry('b', []));
    expect(listener).not.toHaveBeenCalled();
  });

  it('takes a ⌘Z pressed while a redo is still running, and runs it after the redo', async () => {
    const log: string[] = [];
    const stack = new UndoStack();
    let release!: () => void;
    stack.push({
      label: 'a',
      undo: () => log.push('undo a'),
      redo: () =>
        new Promise<void>((resolve) => {
          release = () => {
            log.push('redo a');
            resolve();
          };
        }),
    });
    await stack.undo();
    const redo = stack.redo();
    await Promise.resolve();
    // The entry is on neither stack while its redo runs, but ⌘Z must still reach the stack.
    expect(stack.busy).toBe(true);
    expect(stack.canUndo).toBe(true);
    const undo = stack.undo();
    release();
    await Promise.all([redo, undo]);
    expect(log).toEqual(['undo a', 'redo a', 'undo a']);
    expect(stack.busy).toBe(false);
    expect(stack.canUndo).toBe(false);
  });
});
