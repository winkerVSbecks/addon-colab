import { describe, expect, it } from 'vitest';

import { createCanvasFile } from '../../canvas-file';
import { ASSUMED_FRAME_HEIGHT, describeAnchor, frameRect, summarizeCanvas } from './format';

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
      { type: 'element', frameId: 'frame-a', target: { ...target, context: 'Row C Delete', lookAlikes: 4 } },
      canvas,
      () => undefined,
    );
    expect(location).toMatchObject({ type: 'element', name: 'Delete', context: 'Row C Delete' });
    // The look-alike count is for the board's pin matching only.
    expect(location).not.toHaveProperty('lookAlikes');
  });

  it('leaves context out when the target has none', () => {
    const location = describeAnchor({ type: 'element', frameId: 'frame-a', target }, canvas, () => undefined);
    expect(location).not.toHaveProperty('context');
  });
});

describe('frame heights', () => {
  const base = createCanvasFile({ id: 'heights', name: 'Heights', now: new Date('2026-11-25T00:00:00.000Z') });
  const canvas = {
    ...base,
    frames: [
      { id: 'frame-button', storyId: 'example-button--primary', x: 0, y: 0, width: 240 },
      { id: 'frame-header', storyId: 'example-header--logged-in', x: 0, y: 100, width: 960 },
    ],
    // A circle around the header only.
    strokes: [
      {
        id: 'stroke-1',
        color: 'red',
        width: 2,
        points: [
          [-20, 90],
          [980, 90],
          [980, 190],
          [-20, 190],
        ] as [number, number][],
      },
    ],
  };

  it('assumes a height for frames the board has not reported, and says so', () => {
    const details = summarizeCanvas(canvas, () => undefined);
    expect(details.note).toContain(`${ASSUMED_FRAME_HEIGHT}px`);
    expect(details.frames[0]).not.toHaveProperty('renderedHeight');
    // With 400px assumed, the button's frame reaches into the circle.
    expect(details.strokes[0]?.frames.map((f) => f.frameId)).toContain('frame-button');
  });

  it('uses the heights the board drew the frames at', () => {
    const heights = new Map([
      ['frame-button', 68],
      ['frame-header', 63],
    ]);
    const details = summarizeCanvas(canvas, () => undefined, { heights });
    expect(details.note).toBeUndefined();
    expect(details.frames[0]).toMatchObject({ frameId: 'frame-button', renderedHeight: 68 });
    expect(details.frames[0]).not.toHaveProperty('height');
    expect(details.strokes[0]?.frames).toEqual([
      { frameId: 'frame-header', storyId: 'example-header--logged-in', relation: 'surrounds' },
    ]);
  });

  it('prefers the rendered height over a stored minimum, and the stored one over the assumption', () => {
    const frame = { id: 'f', storyId: 's', x: 0, y: 0, width: 100, height: 50 };
    expect(frameRect(frame)).toMatchObject({ height: 50, heightAssumed: false });
    expect(frameRect(frame, new Map([['f', 80]]))).toMatchObject({ height: 80, heightAssumed: false });
    expect(frameRect({ ...frame, height: undefined })).toMatchObject({
      height: ASSUMED_FRAME_HEIGHT,
      heightAssumed: true,
    });
  });
});
