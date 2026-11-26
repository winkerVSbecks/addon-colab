import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CANVAS_SCHEMA_VERSION,
  type CanvasFile,
  canvasIdFromName,
  createCanvasFile,
  createId,
  isCanvasId,
  parseCanvasFile,
  reopenComment,
  resolveComment,
  serializeCanvasFile,
  validateCanvasFile,
} from './canvas-file';

const fixtureText = readFileSync(new URL('./__fixtures__/example-canvas.json', import.meta.url), 'utf8');
const fixture = (): CanvasFile => JSON.parse(fixtureText);

function expectErrors(value: unknown): string[] {
  const result = validateCanvasFile(value);
  if (result.ok) throw new Error('expected the canvas to be invalid');
  return result.errors;
}

describe('validateCanvasFile: valid files', () => {
  it('accepts the example file with frames, element, frame and position comments, replies and strokes', () => {
    const result = parseCanvasFile(fixtureText);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canvas.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    expect(result.canvas.frames).toHaveLength(2);
    const [elementComment, positionComment, frameComment] = result.canvas.comments;
    expect(elementComment?.anchor.type).toBe('element');
    if (elementComment?.anchor.type === 'element') {
      expect(elementComment.anchor.target.importPath).toBe('./src/stories/Header.stories.ts');
    }
    expect(positionComment?.anchor).toEqual({ type: 'position', x: 120, y: 140 });
    expect(frameComment?.anchor).toEqual({
      type: 'frame',
      frameId: 'frame-button01',
      storyId: 'example-button--primary',
      x: 24,
      y: 12,
    });
    expect(result.canvas.strokes[0]?.points).toHaveLength(5);
  });

  it('accepts an empty canvas', () => {
    expect(validateCanvasFile(createCanvasFile({ id: 'empty', name: 'Empty' })).ok).toBe(true);
  });

  it('accepts optional fields being absent (frame height, role, name, frame anchor offset)', () => {
    const canvas = fixture();
    delete canvas.frames[1]!.height;
    const anchor = canvas.comments[0]!.anchor;
    if (anchor.type === 'element') {
      delete anchor.target.role;
      delete anchor.target.name;
    }
    canvas.comments[2]!.anchor = { type: 'frame', frameId: 'frame-button01', storyId: 'example-button--primary' };
    expect(validateCanvasFile(canvas).ok).toBe(true);
  });

  it('accepts html and text at their 2000-character maximum, and a frame anchor at offset 0,0', () => {
    const canvas = fixture();
    const anchor = canvas.comments[0]!.anchor;
    if (anchor.type !== 'element') throw new Error('fixture comment 0 should be an element comment');
    anchor.target.html = 'x'.repeat(2000);
    anchor.target.text = 'y'.repeat(2000);
    canvas.comments[2]!.anchor = {
      type: 'frame',
      frameId: 'frame-gone',
      storyId: 'example-button--primary',
      x: 0,
      y: 0,
    };
    expect(validateCanvasFile(canvas).ok).toBe(true);
  });

  it('accepts open comments without resolvedAt and resolved comments with it', () => {
    const canvas = fixture();
    expect(canvas.comments.map((c) => [c.status, c.resolvedAt !== undefined])).toEqual([
      ['open', false],
      ['resolved', true],
      ['open', false],
    ]);
    expect(validateCanvasFile(canvas).ok).toBe(true);
  });

  it('drops unknown keys', () => {
    const result = validateCanvasFile({ ...fixture(), extra: true });
    expect(result.ok && 'extra' in result.canvas).toBe(false);
  });
});

describe('validateCanvasFile: invalid files', () => {
  it('rejects non-objects and invalid JSON', () => {
    expect(expectErrors(null)[0]).toMatch(/^\(root\)/);
    expect(expectErrors([])[0]).toMatch(/^\(root\)/);
    const result = parseCanvasFile('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^invalid JSON/);
  });

  it('rejects a missing or unsupported schemaVersion with a clear message', () => {
    const withoutVersion: Partial<CanvasFile> = fixture();
    delete withoutVersion.schemaVersion;
    expect(expectErrors(withoutVersion)[0]).toMatch(/^schemaVersion:/);
    expect(expectErrors({ ...fixture(), schemaVersion: 2 })).toEqual([
      'schemaVersion: unsupported version 2; this addon reads version 1',
    ]);
  });

  it('rejects canvas ids that are not lowercase slugs', () => {
    for (const id of ['Design Review', '../etc', 'a--b', '-a', '']) {
      expect(expectErrors({ ...fixture(), id })[0]).toMatch(/^id:/);
    }
  });

  it('rejects blank names and bad timestamps', () => {
    expect(expectErrors({ ...fixture(), name: '   ' })[0]).toMatch(/^name:/);
    expect(expectErrors({ ...fixture(), updatedAt: 'yesterday' })[0]).toMatch(/^updatedAt:/);
  });

  it('rejects frames without a positive width or with non-numeric positions', () => {
    const canvas = fixture();
    canvas.frames[0]!.width = 0;
    (canvas.frames[1] as unknown as { x: string }).x = '10';
    expect(expectErrors(canvas)).toEqual([
      expect.stringMatching(/^frames\[0\]\.width:/),
      expect.stringMatching(/^frames\[1\]\.x:/),
    ]);
  });

  it('rejects a frame height of zero or below', () => {
    for (const height of [0, -80]) {
      const canvas = fixture();
      canvas.frames[1]!.height = height;
      expect(expectErrors(canvas)).toEqual([expect.stringMatching(/^frames\[1\]\.height:/)]);
    }
  });

  it('rejects element target html or text longer than 2000 characters', () => {
    const canvas = fixture();
    const anchor = canvas.comments[0]!.anchor;
    if (anchor.type !== 'element') throw new Error('fixture comment 0 should be an element comment');
    anchor.target.html = 'x'.repeat(2001);
    anchor.target.text = 'y'.repeat(2001);
    expect(expectErrors(canvas)).toEqual([
      expect.stringMatching(/^comments\[0\]\.anchor\.target\.html:/),
      expect.stringMatching(/^comments\[0\]\.anchor\.target\.text:/),
    ]);
  });

  it('rejects an empty element target role or name', () => {
    const canvas = fixture();
    const anchor = canvas.comments[0]!.anchor;
    if (anchor.type !== 'element') throw new Error('fixture comment 0 should be an element comment');
    anchor.target.role = '';
    anchor.target.name = '';
    expect(expectErrors(canvas)).toEqual([
      expect.stringMatching(/^comments\[0\]\.anchor\.target\.role:/),
      expect.stringMatching(/^comments\[0\]\.anchor\.target\.name:/),
    ]);
  });

  it('rejects a resolved comment without resolvedAt and an open comment with one', () => {
    const canvas = fixture();
    delete canvas.comments[1]!.resolvedAt;
    canvas.comments[2]!.resolvedAt = '2026-11-25T15:40:00.000Z';
    expect(expectErrors(canvas)).toEqual([
      'comments[1].resolvedAt: a resolved comment needs resolvedAt',
      'comments[2].resolvedAt: an open comment must not have resolvedAt',
    ]);
  });

  it('rejects a frame anchor without frameId or storyId, with half an offset, or with a negative offset', () => {
    const canvas = fixture();
    const base = { type: 'frame' as const, frameId: 'frame-button01', storyId: 'example-button--primary' };
    const anchors: unknown[] = [
      { type: 'frame', storyId: 'example-button--primary' },
      { type: 'frame', frameId: 'frame-button01', storyId: '' },
      { ...base, x: 10 },
      { ...base, y: 10 },
      { ...base, x: -1, y: 0 },
    ];
    const comments = anchors.map((anchor, i) => ({ ...canvas.comments[2]!, id: `comment-f${i}`, anchor }));
    expect(expectErrors({ ...canvas, comments })).toEqual([
      expect.stringMatching(/^comments\[0\]\.anchor\.frameId:/),
      expect.stringMatching(/^comments\[1\]\.anchor\.storyId:/),
      'comments[2].anchor.y: x and y must be given together',
      'comments[3].anchor.x: x and y must be given together',
      expect.stringMatching(/^comments\[4\]\.anchor\.x:/),
    ]);
  });

  it('rejects unknown authors and statuses, and empty bodies', () => {
    const canvas = fixture();
    (canvas.comments[0] as unknown as { author: string }).author = 'bot';
    (canvas.comments[1] as unknown as { status: string }).status = 'done';
    canvas.comments[0]!.replies[0]!.body = ' ';
    expect(expectErrors(canvas)).toEqual([
      expect.stringMatching(/^comments\[0\]\.author:/),
      expect.stringMatching(/^comments\[0\]\.replies\[0\]\.body:/),
      expect.stringMatching(/^comments\[1\]\.status:/),
    ]);
  });

  it('rejects an element anchor missing its target fields, and unknown anchor types', () => {
    const canvas = fixture();
    const anchor = canvas.comments[0]!.anchor as unknown as { target: Partial<Record<string, string>> };
    delete anchor.target.selector;
    delete anchor.target.importPath;
    (canvas.comments[1] as unknown as { anchor: unknown }).anchor = { type: 'story', storyId: 'x', x: 0, y: 0 };
    const errors = expectErrors(canvas);
    expect(errors).toContainEqual(expect.stringMatching(/^comments\[0\]\.anchor\.target\.selector:/));
    expect(errors).toContainEqual(expect.stringMatching(/^comments\[0\]\.anchor\.target\.importPath:/));
    expect(errors).toContainEqual(expect.stringMatching(/^comments\[1\]\.anchor\.type:/));
  });

  it('rejects strokes with no points, malformed points, or a non-positive width', () => {
    const base = fixture().strokes[0]!;
    const strokes = [
      { ...base, id: 'stroke-a', points: [] },
      { ...base, id: 'stroke-b', points: [[1, 2, 3]] },
      { ...base, id: 'stroke-c', width: -1 },
    ];
    expect(expectErrors({ ...fixture(), strokes })).toEqual([
      expect.stringMatching(/^strokes\[0\]\.points:/),
      expect.stringMatching(/^strokes\[1\]\.points\[0\]:/),
      expect.stringMatching(/^strokes\[2\]\.width:/),
    ]);
  });

  it('rejects duplicate ids across frames, comments, replies and strokes', () => {
    const canvas = fixture();
    canvas.strokes[0]!.id = 'frame-header01';
    canvas.comments[0]!.replies[0]!.id = 'comment-login01';
    expect(expectErrors(canvas)).toEqual([
      'comments[0].replies[0].id: duplicate id "comment-login01" (first used at comments[0].id)',
      'strokes[0].id: duplicate id "frame-header01" (first used at frames[0].id)',
    ]);
  });
});

describe('serializeCanvasFile', () => {
  it('reproduces the example file byte for byte', () => {
    expect(serializeCanvasFile(fixture())).toBe(fixtureText);
  });

  it('writes keys in schema order regardless of input order, and drops undefined fields', () => {
    const { strokes, comments, frames, ...rest } = fixture();
    const reordered = { strokes, ...rest, comments, frames } as CanvasFile;
    reordered.frames[0]!.height = undefined;
    expect(serializeCanvasFile(reordered)).toBe(fixtureText);
  });

  it('keeps stroke points on one line', () => {
    expect(serializeCanvasFile(fixture())).toContain('"points": [[-10,150],[250,150],[250,250],[-10,250],[-10,150]]');
  });

  it('throws on an invalid canvas instead of writing it', () => {
    expect(() => serializeCanvasFile({ ...fixture(), id: 'Bad Id' })).toThrow(/id:/);
  });
});

describe('resolveComment and reopenComment', () => {
  it('resolveComment sets status and resolvedAt without mutating the input', () => {
    const open = fixture().comments[0]!;
    const resolved = resolveComment(open, new Date('2026-11-25T16:00:00.000Z'));
    expect(resolved).toMatchObject({ status: 'resolved', resolvedAt: '2026-11-25T16:00:00.000Z' });
    expect(open.status).toBe('open');
    expect('resolvedAt' in open).toBe(false);
  });

  it('reopenComment clears resolvedAt so the result validates', () => {
    const canvas = fixture();
    const reopened = reopenComment(canvas.comments[1]!);
    expect(reopened.status).toBe('open');
    expect('resolvedAt' in reopened).toBe(false);
    canvas.comments[1] = reopened;
    expect(validateCanvasFile(canvas).ok).toBe(true);
    expect(serializeCanvasFile(canvas)).not.toContain('"resolvedAt": "2026-11-25T15:30:00.000Z"');
  });
});

describe('helpers', () => {
  it('createCanvasFile sets version, timestamps and empty collections', () => {
    const now = new Date('2026-11-25T12:00:00.000Z');
    expect(createCanvasFile({ id: 'sprint-12', name: 'Sprint 12', now })).toEqual({
      schemaVersion: 1,
      id: 'sprint-12',
      name: 'Sprint 12',
      createdAt: '2026-11-25T12:00:00.000Z',
      updatedAt: '2026-11-25T12:00:00.000Z',
      frames: [],
      comments: [],
      strokes: [],
    });
    expect(() => createCanvasFile({ id: 'Nope', name: 'x' })).toThrow();
  });

  it('canvasIdFromName produces valid ids', () => {
    expect(canvasIdFromName('Sprint 12 review!')).toBe('sprint-12-review');
    expect(canvasIdFromName('  Café — Höme  ')).toBe('cafe-home');
    expect(canvasIdFromName('!!!')).toBe('');
    expect(isCanvasId(canvasIdFromName('x'.repeat(300)))).toBe(true);
  });

  it('createId returns unique ids that pass validation', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId('comment')));
    expect(ids.size).toBe(1000);
    const [first] = ids;
    expect(first).toMatch(/^comment-[0-9a-f]{12}$/);
  });
});
