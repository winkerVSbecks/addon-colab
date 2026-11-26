/**
 * Tells the server how tall the board draws each frame, so the agent's view of the canvas (MCP
 * summaries) uses real sizes. Reports wait until heights settle (stories finish loading, fonts
 * arrive) and only send changes. Nothing here writes the canvas file: a frame's stored `height` is
 * only ever the minimum the user resized it to.
 */
import { useCallback, useEffect, useRef } from 'react';

import { applyRenderedHeightReport, renderedHeightReport } from '../../board/rendered-heights';
import type { Frame } from '../../canvas-file';
import { type ChannelLike, requestCanvas } from '../../channel';

/** How long heights must hold before they are reported. */
const REPORT_DELAY = 800;

/** Returns `report(frameId, height)`; pass `null` while the frame's story is not rendered. */
export function useRenderedHeights(
  canvasId: string,
  channel: ChannelLike,
  frames: readonly Pick<Frame, 'id'>[],
): (frameId: string, height: number | null) => void {
  const current = useRef(new Map<string, number | null>());
  /** What the server was told; `undefined` until this board's first report. */
  const sent = useRef<Map<string, number> | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const sending = useRef(false);
  const frameIds = useRef(new Set<string>());
  frameIds.current = new Set(frames.map((frame) => frame.id));

  const flush = useCallback(() => {
    timer.current = undefined;
    if (sending.current) {
      timer.current = setTimeout(flush, REPORT_DELAY);
      return;
    }
    const report = renderedHeightReport(sent.current, current.current, frameIds.current);
    if (!report) return;
    sending.current = true;
    requestCanvas(channel, 'reportRenderedHeights', { canvasId, ...report })
      .then(() => {
        sent.current = applyRenderedHeightReport(sent.current, report);
      })
      // Only the agent's view depends on this, and the next change reports again: no notice.
      .catch(() => undefined)
      .finally(() => {
        sending.current = false;
      });
  }, [canvasId, channel]);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, REPORT_DELAY);
  }, [flush]);

  const report = useCallback(
    (frameId: string, height: number | null) => {
      current.current.set(frameId, height);
      schedule();
    },
    [schedule],
  );

  // Removed frames: tell the server to forget them.
  const idsKey = frames.map((frame) => frame.id).join(' ');
  useEffect(() => {
    for (const frameId of current.current.keys()) {
      if (!frameIds.current.has(frameId)) current.current.delete(frameId);
    }
    if ([...(sent.current?.keys() ?? [])].some((frameId) => !frameIds.current.has(frameId))) schedule();
  }, [idsKey, schedule]);

  useEffect(() => {
    current.current = new Map();
    sent.current = undefined;
    return () => clearTimeout(timer.current);
  }, [canvasId]);

  return report;
}
