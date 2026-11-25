/**
 * Frame changes made on the board: shown at once, written to the store once per gesture, and kept
 * on top of the canvas file until the file has caught up (see `src/board/frame-edits.ts`), so our
 * own change event never snaps a frame back and remote changes still show.
 *
 * Also saves each frame's measured height when it differs from the stored one, so the agent's view
 * of the canvas (MCP summaries) uses real sizes instead of an assumed 400px.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type FrameEditChanges,
  type FrameEdits,
  applyFrameEdits,
  dropEdit,
  markSaved,
  markSaving,
  settleFrameEdits,
  withLiveEdit,
} from '../../board/frame-edits';
import { withMinimumSize } from '../../board/frame-defaults';
import type { CanvasFile, Frame } from '../../canvas-file';
import { CanvasRequestError, type ChannelLike, type FrameChanges, requestCanvas } from '../../channel';

/** How long a measured height must hold before it is saved (stories settle after loaders, fonts). */
const HEIGHT_SAVE_DELAY = 800;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface FrameEditsApi {
  /** The frames to show: the file plus local edits, at no less than the minimum frame size. */
  frames: Frame[];
  /** Shows a change at once without saving (during a drag). */
  preview: (frameId: string, changes: FrameEditChanges) => void;
  /** Saves the frame's pending change (end of a drag). */
  commit: (frameId: string) => void;
  /** Hides the frame at once and removes it from the file. Resolves to whether the file was changed. */
  remove: (frameId: string) => Promise<boolean>;
  /**
   * Puts a removed frame back with the same id, at `index` in the stacking order (undo of `remove`).
   * Resolves to whether the frame is on the canvas afterwards.
   */
  restore: (frame: Frame, index: number) => Promise<boolean>;
  /** Reports a rendered height; saved after it settles if it differs from the file. */
  measured: (frameId: string, height: number) => void;
  /** Frame ids with a pointer gesture in progress (their measured height is not saved meanwhile). */
  setBusy: (frameId: string, busy: boolean) => void;
}

export function useFrameEdits(
  canvas: CanvasFile,
  channel: ChannelLike,
  onError: (message: string) => void,
): FrameEditsApi {
  const editsRef = useRef<FrameEdits>(new Map());
  const [version, setVersion] = useState(0);
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const busyRef = useRef(new Set<string>());
  const heightTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastHeights = useRef(new Map<string, number>());

  const update = useCallback((next: FrameEdits) => {
    if (next === editsRef.current) return;
    editsRef.current = next;
    setVersion((v) => v + 1);
  }, []);

  // Every new file state: forget edits the file has caught up with.
  useEffect(() => {
    update(settleFrameEdits(editsRef.current, canvas.frames, canvas.updatedAt));
  }, [canvas, update]);

  const write = useCallback(
    async (frameId: string, run: () => Promise<{ canvas: CanvasFile }>): Promise<boolean> => {
      const saving = markSaving(editsRef.current, frameId);
      update(saving.edits);
      try {
        const result = await run();
        update(markSaved(editsRef.current, frameId, saving.revision ?? -1, result.canvas.updatedAt));
        const latest = canvasRef.current;
        update(settleFrameEdits(editsRef.current, latest.frames, latest.updatedAt));
        return true;
      } catch (error) {
        update(dropEdit(editsRef.current, frameId, saving.revision));
        // The frame was removed elsewhere meanwhile: nothing to save, and nothing to tell.
        if (error instanceof CanvasRequestError && error.code === 'NOT_FOUND') return false;
        onErrorRef.current(`Couldn't save the change: ${describe(error)}`);
        return false;
      }
    },
    [update],
  );

  const preview = useCallback(
    (frameId: string, changes: FrameEditChanges) => update(withLiveEdit(editsRef.current, frameId, changes)),
    [update],
  );

  const commit = useCallback(
    (frameId: string) => {
      const edit = editsRef.current.get(frameId);
      if (!edit || edit.state !== 'live') return;
      const changes: FrameChanges = { ...edit.changes };
      delete (changes as FrameEditChanges).removed;
      const file = canvasRef.current.frames.find((frame) => frame.id === frameId);
      // Nothing actually changed (a click on the title): drop the edit without a write.
      const unchanged =
        !!file &&
        (Object.keys(changes) as (keyof FrameChanges)[]).every((key) =>
          key === 'height' ? (changes.height ?? undefined) === file.height : changes[key] === file[key],
        );
      if (unchanged) {
        update(dropEdit(editsRef.current, frameId, edit.revision));
        return;
      }
      void write(frameId, () =>
        requestCanvas(channel, 'updateFrame', { canvasId: canvasRef.current.id, frameId, changes }),
      );
    },
    [channel, update, write],
  );

  const remove = useCallback(
    (frameId: string) => {
      update(withLiveEdit(editsRef.current, frameId, { removed: true }));
      return write(frameId, () => requestCanvas(channel, 'removeFrame', { canvasId: canvasRef.current.id, frameId }));
    },
    [channel, update, write],
  );

  const restore = useCallback(
    async (frame: Frame, index: number) => {
      try {
        await requestCanvas(channel, 'restoreFrame', { canvasId: canvasRef.current.id, frame, index });
        return true;
      } catch (error) {
        // Already back (undone twice, or restored elsewhere): nothing to do.
        if (error instanceof CanvasRequestError && error.code === 'ALREADY_EXISTS') return true;
        onErrorRef.current(`Couldn't put the story back: ${describe(error)}`);
        return false;
      }
    },
    [channel],
  );

  const measured = useCallback(
    (frameId: string, height: number) => {
      lastHeights.current.set(frameId, height);
      clearTimeout(heightTimers.current.get(frameId));
      heightTimers.current.set(
        frameId,
        setTimeout(() => {
          heightTimers.current.delete(frameId);
          const rounded = Math.round(height);
          const file = canvasRef.current.frames.find((frame) => frame.id === frameId);
          if (!file || rounded <= 0 || file.height === rounded) return;
          if (busyRef.current.has(frameId) || editsRef.current.has(frameId)) return;
          requestCanvas(channel, 'updateFrame', {
            canvasId: canvasRef.current.id,
            frameId,
            changes: { height: rounded },
          }).catch((error: unknown) => {
            if (error instanceof CanvasRequestError && error.code === 'NOT_FOUND') return;
            onErrorRef.current(`Couldn't save the story's height: ${describe(error)}`);
          });
        }, HEIGHT_SAVE_DELAY),
      );
    },
    [channel],
  );

  // A height measured while the frame had a pending edit was not saved; check again once settled.
  useEffect(() => {
    for (const frame of canvas.frames) {
      const height = lastHeights.current.get(frame.id);
      if (height !== undefined && Math.round(height) !== frame.height && !heightTimers.current.has(frame.id)) {
        measured(frame.id, height);
      }
    }
  }, [canvas, version, measured]);

  useEffect(() => {
    const timers = heightTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  const setBusy = useCallback((frameId: string, busy: boolean) => {
    if (busy) busyRef.current.add(frameId);
    else busyRef.current.delete(frameId);
  }, []);

  // `version` changes whenever the edits (kept in a ref) change.
  const frames = useMemo(
    () => applyFrameEdits(canvas.frames, editsRef.current).map(withMinimumSize),
    [canvas.frames, version],
  );

  return { frames, preview, commit, remove, restore, measured, setBusy };
}
