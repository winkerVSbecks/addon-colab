/** Text helpers for the Canvases menu and dialogs, kept apart from the components so they can be tested in Node. */

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
