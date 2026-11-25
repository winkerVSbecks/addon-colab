import { describe, expect, it } from 'vitest';

import { draggableStoryId } from './sidebar-drag';

/** A stand-in for a sidebar row: only `dataset` is read. */
function row(dataset: Record<string, string>) {
  return { dataset } as unknown as Element;
}

const entries: Record<string, { type: string; tags?: string[] }> = {
  'example-button--primary': { type: 'story', tags: ['dev'] },
  'example-button--docs': { type: 'docs' },
  'colab-canvas-board--canvas': { type: 'story', tags: ['colab-canvas'] },
  'odd-canvas--story': { type: 'story', tags: ['colab-canvas'] },
};
const api = { getData: (id: string) => entries[id] };

describe('draggableStoryId', () => {
  it('accepts story rows of this Storybook', () => {
    expect(
      draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--primary', refId: 'storybook_internal' }), api),
    ).toBe('example-button--primary');
    // Rows without a ref id are this Storybook's too.
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--primary' }), api)).toBe(
      'example-button--primary',
    );
  });

  it('rejects components, groups and docs entries', () => {
    expect(draggableStoryId(row({ nodetype: 'component', itemId: 'example-button' }), api)).toBeUndefined();
    expect(draggableStoryId(row({ nodetype: 'group', itemId: 'example' }), api)).toBeUndefined();
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--docs' }), api)).toBeUndefined();
  });

  it('rejects canvases, by id or by tag', () => {
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'colab-canvas-board--canvas' }), api)).toBeUndefined();
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'odd-canvas--story' }), api)).toBeUndefined();
  });

  it('rejects stories of composed Storybooks and unknown ids', () => {
    expect(
      draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--primary', refId: 'design-system' }), api),
    ).toBeUndefined();
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'missing--story' }), api)).toBeUndefined();
    const throwing = {
      getData: () => {
        throw new Error('no index yet');
      },
    };
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--primary' }), throwing)).toBeUndefined();
  });
});
