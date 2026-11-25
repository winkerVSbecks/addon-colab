import { describe, expect, it } from 'vitest';

import { deleteContents } from './wording';

describe('delete dialog wording', () => {
  it('names only what the canvas holds', () => {
    expect(deleteContents({ frames: 0, comments: 0 })).toBe('');
    expect(deleteContents({ frames: 1, comments: 0 })).toBe(' with its 1 story');
    expect(deleteContents({ frames: 0, comments: 2 })).toBe(' with its 2 comments');
    expect(deleteContents({ frames: 3, comments: 1 })).toBe(' with its 3 stories and 1 comment');
    expect(deleteContents(undefined)).toBe('');
  });
});
