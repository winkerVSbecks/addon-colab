/** Text helpers for the Canvases menu and dialogs, kept apart from the components so they can be tested in Node. */
import { canvasNameKey } from '../canvas-entry';

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What else goes with a deleted canvas, e.g. " with its 3 stories and 1 comment"; empty when there is nothing. */
export function deleteContents(counts?: { frames: number; comments: number }): string {
  if (!counts) return '';
  const parts = [
    counts.frames > 0 ? plural(counts.frames, 'story', 'stories') : '',
    counts.comments > 0 ? plural(counts.comments, 'comment') : '',
  ].filter(Boolean);
  return parts.length ? ` with its ${parts.join(' and ')}` : '';
}

/** Names (by `canvasNameKey`) that more than one canvas uses. */
export function duplicateNames(canvases: { name: string }[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { name } of canvases) {
    const key = canvasNameKey(name);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}

/** The second line of a canvas in the menu. Canvases that share a name also show their file name. */
export function canvasDetails(
  canvas: { id: string; frameCount: number; openCommentCount: number },
  { showFile = false } = {},
): string {
  const parts = [plural(canvas.frameCount, 'story', 'stories')];
  if (canvas.openCommentCount) parts.push(`${canvas.openCommentCount} open`);
  if (showFile) parts.unshift(`${canvas.id}.json`);
  return parts.join(' · ');
}
