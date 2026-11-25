import { describe, expect, it } from 'vitest';

import { storyTitle, storyTitleFromId } from './story-title';

describe('storyTitle', () => {
  it('uses the last part of the title path and the story name', () => {
    expect(storyTitle({ title: 'Example/Button', name: 'Primary' })).toEqual({
      short: 'Button / Primary',
      full: 'Example/Button › Primary',
    });
    expect(storyTitle({ title: 'Button', name: 'Primary' }).short).toBe('Button / Primary');
  });
});

describe('storyTitleFromId', () => {
  it('makes a readable title from a story id', () => {
    expect(storyTitleFromId('example-page--logged-out')).toEqual({
      short: 'Example Page / Logged Out',
      full: 'Example Page › Logged Out',
    });
  });

  it('copes with ids that are not in the usual shape', () => {
    expect(storyTitleFromId('button').short).toBe('Button');
    expect(storyTitleFromId('--primary').short).toBe('Primary');
    expect(storyTitleFromId('a--b--c').short).toBe('A B / C');
    expect(storyTitleFromId('').short).toBe('');
    expect(storyTitleFromId('--').short).toBe('--');
  });
});
