/**
 * The board's strokes: the canvas file's, with this board's drawing and erasing shown at once
 * (`src/board/stroke-edits.ts`), each change written once through the store and pushed to the
 * board's undo stack (`src/board/undo-stack.ts`) so ⌘Z / ⇧⌘Z undo and redo it.
 *
 * Undo and redo keep stroke ids: undoing an erase or a clear puts the same strokes back at their
 * place in the drawing order (`restoreStrokes`), and redoing a drawn stroke restores it under the
 * id the store gave it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  NO_STROKE_EDITS,
  type StrokeEdits,
  settleStrokeEdits,
  visibleStrokes,
  withAdded,
  withRemoveDone,
  withRemoved,
  withSaved,
  withoutAdded,
} from '../../board/stroke-edits';
import type { UndoEntry, UndoStack } from '../../board/undo-stack';
import type { CanvasFile, Stroke } from '../../canvas-file';
import { CanvasRequestError, type ChannelLike, type StrokeInput, requestCanvas } from '../../channel';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const isNotFound = (error: unknown) => error instanceof CanvasRequestError && error.code === 'NOT_FOUND';

export interface StrokesApi {
  /** What to draw: the file's strokes plus local changes, in drawing order. */
  strokes: Stroke[];
  /** Saves a drawn stroke (shown at once). */
  draw: (input: StrokeInput) => void;
  /** Erases strokes (hidden at once), as one undoable step. */
  erase: (strokes: readonly Stroke[]) => void;
  /** Removes every stroke, as one undoable step. Resolves to the entry (for a notice's Undo), if any. */
  clear: () => Promise<UndoEntry | undefined>;
}

let localIds = 0;

/** Groups strokes to put back into runs of consecutive indices, in index order. */
export function contiguousRuns(entries: readonly { stroke: Stroke; index: number }[]) {
  const runs: { index: number; strokes: Stroke[] }[] = [];
  for (const { stroke, index } of [...entries].sort((a, b) => a.index - b.index)) {
    const last = runs[runs.length - 1];
    if (last && index === last.index + last.strokes.length) last.strokes.push(stroke);
    else runs.push({ index, strokes: [stroke] });
  }
  return runs;
}

export function useStrokes(
  canvas: CanvasFile,
  channel: ChannelLike,
  undo: UndoStack,
  onError: (message: string) => void,
): StrokesApi {
  const [edits, setEditsState] = useState<StrokeEdits>(NO_STROKE_EDITS);
  const editsRef = useRef(edits);
  const setEdits = useCallback((update: (edits: StrokeEdits) => StrokeEdits) => {
    const next = update(editsRef.current);
    if (next === editsRef.current) return;
    editsRef.current = next;
    setEditsState(next);
  }, []);
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  /** Saves still in flight, by temporary id, so erasing an unsaved stroke waits for its real id. */
  const saving = useRef(new Map<string, Promise<Stroke | undefined>>());

  useEffect(() => {
    setEdits((current) => settleStrokeEdits(current, canvas.strokes));
  }, [canvas.strokes, setEdits]);

  const canvasId = () => canvasRef.current.id;

  /** Removes saved strokes by id. A stroke already gone (erased elsewhere) counts as removed. */
  const removeIds = useCallback(
    async (ids: readonly string[]) => {
      if (ids.length === 0) return true;
      setEdits((current) => withRemoved(current, ids));
      const results = await Promise.all(
        ids.map((strokeId) =>
          requestCanvas(channel, 'removeStroke', { canvasId: canvasId(), strokeId }).then(
            () => true,
            (error: unknown) => {
              if (isNotFound(error)) return true;
              onErrorRef.current(`Couldn't erase the stroke: ${describe(error)}`);
              return false;
            },
          ),
        ),
      );
      ids.forEach((id, i) => setEdits((current) => withRemoveDone(current, [id], results[i]!)));
      return results.every(Boolean);
    },
    [channel, setEdits],
  );

  /** Puts strokes back with their ids, each at its old place in the drawing order. */
  const restore = useCallback(
    async (entries: readonly { stroke: Stroke; index: number }[]) => {
      for (const { stroke } of entries) setEdits((current) => withAdded(current, stroke));
      try {
        // One write per run of neighbouring strokes (a whole clear goes back in one write).
        for (const run of contiguousRuns(entries)) {
          await requestCanvas(channel, 'restoreStrokes', {
            canvasId: canvasId(),
            strokes: run.strokes,
            index: run.index,
          });
        }
        return true;
      } catch (error) {
        for (const { stroke } of entries) setEdits((current) => withoutAdded(current, stroke.id));
        onErrorRef.current(`Couldn't put the drawing back: ${describe(error)}`);
        return false;
      }
    },
    [channel, setEdits],
  );

  const draw = useCallback(
    (input: StrokeInput) => {
      const temporaryId = `local-${++localIds}`;
      setEdits((current) => withAdded(current, { id: temporaryId, ...input }));
      const saved = requestCanvas(channel, 'addStroke', { canvasId: canvasId(), stroke: input }).then(
        ({ stroke }) => {
          const erased = editsRef.current.removed.has(temporaryId);
          setEdits((current) => withSaved(current, temporaryId, stroke));
          if (erased) void removeIds([stroke.id]);
          return stroke;
        },
        (error: unknown) => {
          setEdits((current) => withoutAdded(current, temporaryId));
          onErrorRef.current(`Couldn't save the drawing: ${describe(error)}`);
          return undefined;
        },
      );
      saving.current.set(temporaryId, saved);
      void saved.finally(() => saving.current.delete(temporaryId));
      let index = -1;
      undo.push({
        label: 'Draw',
        undo: async () => {
          const stroke = await saved;
          if (!stroke) return false;
          index = canvasRef.current.strokes.findIndex((s) => s.id === stroke.id);
          return removeIds([stroke.id]);
        },
        redo: async () => {
          const stroke = await saved;
          return !!stroke && restore([{ stroke, index: index < 0 ? canvasRef.current.strokes.length : index }]);
        },
      });
    },
    [channel, removeIds, restore, setEdits, undo],
  );

  const erase = useCallback(
    (strokes: readonly Stroke[]) => {
      if (strokes.length === 0) return;
      const file = canvasRef.current.strokes;
      const positions = strokes.map((stroke) => ({ stroke, index: file.findIndex((s) => s.id === stroke.id) }));
      // Strokes drawn here whose save has not finished: hide now, remove once they have their real id.
      const unsaved = strokes.filter((stroke) => saving.current.has(stroke.id));
      const pending = new Map(unsaved.map((stroke) => [stroke.id, saving.current.get(stroke.id)!]));
      setEdits((current) =>
        withRemoved(
          current,
          unsaved.map((stroke) => stroke.id),
        ),
      );
      const saved = strokes.filter((stroke) => !saving.current.has(stroke.id));
      const removed = Promise.all([removeIds(saved.map((stroke) => stroke.id)), ...pending.values()]);
      const resolveIds = async () => {
        await removed;
        // Unsaved strokes are swapped for their saved versions (same points, real id).
        const real = new Map(await Promise.all([...pending].map(async ([id, save]) => [id, await save] as const)));
        return positions
          .map(({ stroke, index }) => ({ stroke: real.get(stroke.id) ?? stroke, index }))
          .filter(({ stroke }) => !stroke.id.startsWith('local-'));
      };
      undo.push({
        label: strokes.length === 1 ? 'Erase stroke' : `Erase ${strokes.length} strokes`,
        undo: async () => {
          const entries = await resolveIds();
          return restore(
            entries.map(({ stroke, index }) => ({
              stroke,
              index: index < 0 ? canvasRef.current.strokes.length : index,
            })),
          );
        },
        redo: async () => removeIds((await resolveIds()).map(({ stroke }) => stroke.id)),
      });
    },
    [removeIds, restore, setEdits, undo],
  );

  const clear = useCallback(async () => {
    const shown = visibleStrokes(canvasRef.current.strokes, editsRef.current);
    if (shown.length === 0) return undefined;
    // Wait for strokes still being saved, so the clear removes them too.
    await Promise.all(saving.current.values());
    const ids = canvasRef.current.strokes.map((stroke) => stroke.id);
    setEdits((current) => withRemoved(current, ids));
    let removed: Stroke[];
    try {
      removed = (await requestCanvas(channel, 'clearStrokes', { canvasId: canvasId() })).strokes;
      setEdits((current) => withRemoveDone(current, ids, true));
    } catch (error) {
      setEdits((current) => withRemoveDone(current, ids, false));
      onErrorRef.current(`Couldn't clear the drawing: ${describe(error)}`);
      return undefined;
    }
    if (removed.length === 0) return undefined;
    return undo.push({
      label: removed.length === 1 ? 'Clear 1 stroke' : `Clear ${removed.length} strokes`,
      undo: () => restore(removed.map((stroke, index) => ({ stroke, index }))),
      redo: () => removeIds(removed.map((stroke) => stroke.id)),
    });
  }, [channel, removeIds, restore, setEdits, undo]);

  const strokes = useMemo(() => visibleStrokes(canvas.strokes, edits), [canvas.strokes, edits]);
  return { strokes, draw, erase, clear };
}
