/**
 * What the board tells the server about how tall it draws each frame (`reportRenderedHeights`).
 * The server keeps these in memory for the agent's view of the canvas; nothing is written to the
 * canvas file. Pure functions; the hook is `src/canvas-page/board/use-rendered-heights.ts`.
 */

/** Height changes smaller than this (CSS pixels) are not reported again. */
export const RENDERED_HEIGHT_TOLERANCE = 2;

export interface RenderedHeightReport {
  heights: Record<string, number | null>;
  /** The board's first report: the server forgets every height it was told before (an earlier page). */
  replace?: true;
}

/**
 * The report to send: heights that are new or moved by at least the tolerance, and `null` for
 * frames whose height the server should forget (their story is not rendered, or the frame is no
 * longer on the canvas). Returns `undefined` when there is nothing to send.
 *
 * @param sent what the server was last told, by frame id; `undefined` before the board's first
 *   report, which then replaces whatever an earlier page reported, so it is sent even when empty
 * @param current the latest height of each frame on the board; `null` while its story is not rendered
 * @param frameIds the frames on the canvas now
 */
export function renderedHeightReport(
  sent: ReadonlyMap<string, number> | undefined,
  current: ReadonlyMap<string, number | null>,
  frameIds: ReadonlySet<string>,
): RenderedHeightReport | undefined {
  if (!sent) {
    const heights: Record<string, number> = {};
    for (const [frameId, height] of current) {
      if (frameIds.has(frameId) && height !== null && Number.isFinite(height) && height > 0) {
        heights[frameId] = Math.round(height);
      }
    }
    return { heights, replace: true };
  }
  const report: Record<string, number | null> = {};
  let any = false;
  for (const [frameId, height] of current) {
    if (!frameIds.has(frameId)) continue;
    const previous = sent.get(frameId);
    if (height === null || !Number.isFinite(height) || height <= 0) {
      if (previous !== undefined) {
        report[frameId] = null;
        any = true;
      }
      continue;
    }
    const rounded = Math.round(height);
    if (previous === undefined || Math.abs(previous - rounded) >= RENDERED_HEIGHT_TOLERANCE) {
      report[frameId] = rounded;
      any = true;
    }
  }
  for (const frameId of sent.keys()) {
    if (!frameIds.has(frameId)) {
      report[frameId] = null;
      any = true;
    }
  }
  return any ? { heights: report } : undefined;
}

/** `sent` after the server accepted `report`. */
export function applyRenderedHeightReport(
  sent: ReadonlyMap<string, number> | undefined,
  report: RenderedHeightReport,
): Map<string, number> {
  const next = new Map(report.replace ? undefined : sent);
  for (const [frameId, height] of Object.entries(report.heights)) {
    if (height === null) next.delete(frameId);
    else next.set(frameId, height);
  }
  return next;
}
