import { describe, expect, it } from 'vitest';

import { canvasDetails, deleteContents, duplicateNames } from './wording';

describe('delete dialog wording', () => {
  it('names only what the canvas holds', () => {
    expect(deleteContents({ frames: 0, comments: 0 })).toBe('');
    expect(deleteContents({ frames: 1, comments: 0 })).toBe(' with its 1 story');
    expect(deleteContents({ frames: 0, comments: 2 })).toBe(' with its 2 comments');
    expect(deleteContents({ frames: 3, comments: 1 })).toBe(' with its 3 stories and 1 comment');
    expect(deleteContents(undefined)).toBe('');
  });
});

describe('canvas menu wording', () => {
  it('finds names used by more than one canvas', () => {
    expect([...duplicateNames([{ name: 'Board' }, { name: 'board ' }, { name: 'Other' }])]).toEqual(['board']);
  });

  it('shows the file name only for canvases that share a name', () => {
    const canvas = { id: 'board-2', frameCount: 1, openCommentCount: 2 };
    expect(canvasDetails(canvas)).toBe('1 story · 2 open');
    expect(canvasDetails(canvas, { showFile: true })).toBe('board-2.json · 1 story · 2 open');
  });
});
