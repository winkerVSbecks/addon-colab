/**
 * The board's one undo stack. Every undoable change on the board (removing a frame, deleting a
 * comment, drawing or erasing a stroke) pushes one entry; ⌘Z / Ctrl+Z undoes the latest and
 * ⇧⌘Z / Ctrl+Shift+Z (or Ctrl+Y) redoes it. A notice's Undo button undoes its own entry, wherever it
 * is in the stack, so a later notice never takes an earlier undo away.
 *
 * Undo and redo run one at a time, in order: a second ⌘Z waits for the first to finish (a restore
 * must land before the next one starts). An entry whose undo or redo fails (throws or resolves to
 * `false`) is dropped rather than moved to the other stack.
 *
 * No DOM and no React, so it runs in Node tests. `use-undo-stack.ts` wraps it for the board.
 */

export interface UndoEntry {
  /** What the change was, for notices and tooltips: "Remove Button", "Delete comment". */
  label: string;
  /** Reverts the change. Resolve to `false` (or throw) when it could not be reverted. */
  undo: () => unknown;
  /** Applies the change again after an undo. Without it, an undone entry cannot be redone. */
  redo?: () => unknown;
}

export type UndoListener = () => void;

/** How many entries the stack keeps; older ones are forgotten. */
export const UNDO_LIMIT = 100;

async function run(action: () => unknown): Promise<boolean> {
  try {
    return (await action()) !== false;
  } catch {
    return false;
  }
}

export class UndoStack {
  private done: UndoEntry[] = [];
  private undone: UndoEntry[] = [];
  private listeners = new Set<UndoListener>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly limit = UNDO_LIMIT) {}

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** The entry ⌘Z would undo next. */
  get nextUndo(): UndoEntry | undefined {
    return this.done[this.done.length - 1];
  }

  /** The entry ⇧⌘Z would redo next. */
  get nextRedo(): UndoEntry | undefined {
    return this.undone[this.undone.length - 1];
  }

  /** Whether the entry can still be undone (it has not been undone, dropped or forgotten). */
  has(entry: UndoEntry): boolean {
    return this.done.includes(entry);
  }

  /** Records a change that has just been made. Clears the redo stack. Returns the entry. */
  push(entry: UndoEntry): UndoEntry {
    this.done.push(entry);
    if (this.done.length > this.limit) this.done.splice(0, this.done.length - this.limit);
    this.undone = [];
    this.emit();
    return entry;
  }

  /** Undoes the latest entry. Resolves to the entry, or undefined when there was none or it failed. */
  undo(): Promise<UndoEntry | undefined> {
    return this.enqueue(async () => {
      const entry = this.done.pop();
      if (!entry) return undefined;
      this.emit();
      const ok = await run(entry.undo);
      if (ok && entry.redo) {
        this.undone.push(entry);
        this.emit();
      }
      return ok ? entry : undefined;
    });
  }

  /** Redoes the latest undone entry. */
  redo(): Promise<UndoEntry | undefined> {
    return this.enqueue(async () => {
      const entry = this.undone.pop();
      if (!entry?.redo) return undefined;
      this.emit();
      const ok = await run(entry.redo);
      if (ok) {
        this.done.push(entry);
        this.emit();
      }
      return ok ? entry : undefined;
    });
  }

  /**
   * Undoes one particular entry (a notice's Undo button), even when later changes sit above it.
   * Resolves to whether it was undone. It can be redone only if it was the latest entry.
   */
  undoEntry(entry: UndoEntry): Promise<boolean> {
    return this.enqueue(async () => {
      const index = this.done.lastIndexOf(entry);
      if (index < 0) return false;
      const wasLatest = index === this.done.length - 1;
      this.done.splice(index, 1);
      this.emit();
      const ok = await run(entry.undo);
      if (ok && wasLatest && entry.redo) {
        this.undone.push(entry);
        this.emit();
      }
      return ok;
    });
  }

  /** Forgets everything (another canvas was opened). */
  clear(): void {
    this.done = [];
    this.undone = [];
    this.emit();
  }

  /** Called after every change to the stack. Returns an unsubscribe function. */
  subscribe(listener: UndoListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once every undo or redo started so far has finished. */
  settled(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
