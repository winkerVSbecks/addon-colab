import { describe, expect, it } from 'vitest';

import { createCanvasFile } from '../../canvas-file';
import { describeAnchor } from './format';

describe('describeAnchor', () => {
  const canvas = createCanvasFile({ id: 'rows', name: 'Rows', now: new Date('2026-11-25T00:00:00.000Z') });
  const target = {
    storyId: 'example-rows--default',
    title: 'Example/Rows',
    importPath: './src/stories/Rows.stories.tsx',
    selector: 'ul.rows > li:nth-of-type(3) > button',
    html: '<button>Delete</button>',
    text: 'Delete',
    role: 'button',
    name: 'Delete',
  };

  it("passes on the row's text for an element in a repeated row", () => {
    const location = describeAnchor(
      { type: 'element', frameId: 'frame-a', target: { ...target, context: 'Row C Delete' } },
      canvas,
      () => undefined,
    );
    expect(location).toMatchObject({ type: 'element', name: 'Delete', context: 'Row C Delete' });
  });

  it('leaves context out when the target has none', () => {
    const location = describeAnchor({ type: 'element', frameId: 'frame-a', target }, canvas, () => undefined);
    expect(location).not.toHaveProperty('context');
  });
});
