/**
 * The board's undo stack (`src/board/undo-stack.ts`) as a React hook: one stack per board, plus
 * `canUndo` / `canRedo` that re-render when it changes. The board's key handler is the only ⌘Z /
 * ⇧⌘Z owner; features push entries with `stack.push({ label, undo, redo })`.
 */
import { useEffect, useMemo, useState } from 'react';

import { UndoStack } from '../../board/undo-stack';

export interface UndoStackState {
  stack: UndoStack;
  canUndo: boolean;
  canRedo: boolean;
  /** Changes whenever the stack changes (for memos that read `stack.has(entry)`). */
  version: number;
}

/** One stack for the life of the board; cleared when `resetKey` (the canvas id) changes. */
export function useUndoStack(resetKey: string): UndoStackState {
  const stack = useMemo(() => new UndoStack(), []);
  const [version, setVersion] = useState(0);
  useEffect(() => stack.subscribe(() => setVersion((v) => v + 1)), [stack]);
  useEffect(() => () => stack.clear(), [stack, resetKey]);
  return { stack, canUndo: stack.canUndo, canRedo: stack.canRedo, version };
}
