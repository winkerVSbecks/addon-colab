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
  it('accepts the example file with frames, element and position comments, replies and strokes', () => {
    const result = parseCanvasFile(fixtureText);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canvas.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    expect(result.canvas.frames).toHaveLength(2);
    const [elementComment, positionComment] = result.canvas.comments;
    expect(elementComment?.anchor.type).toBe('element');
    if (elementComment?.anchor.type === 'element') {
      expect(elementComment.anchor.target.importPath).toBe('./src/stories/Header.stories.ts');
    }
    expect(positionComment?.anchor).toEqual({ type: 'position', x: 120, y: 140 });
    expect(result.canvas.strokes[0]?.points).toHaveLength(5);
  });

  it('accepts an empty canvas', () => {
    expect(validateCanvasFile(createCanvasFile({ id: 'empty', name: 'Empty' })).ok).toBe(true);
  });

  it('accepts optional fields being absent (frame height, role, name, resolvedAt)', () => {
    const canvas = fixture();
    delete canvas.frames[1]!.height;
    const anchor = canvas.comments[0]!.anchor;
    if (anchor.type === 'element') {
      delete anchor.target.role;
      delete anchor.target.name;
    }
    delete canvas.comments[1]!.resolvedAt;
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
    const anchor = canvas.comments[0]!.anchor as { target: Partial<Record<string, string>> };
    delete anchor.target.selector;
    delete anchor.target.importPath;
    (canvas.comments[1] as unknown as { anchor: unknown }).anchor = { type: 'story', storyId: 'x' };
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
