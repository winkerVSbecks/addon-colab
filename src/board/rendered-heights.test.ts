import { describe, expect, it } from 'vitest';

import { RENDERED_HEIGHT_TOLERANCE, applyRenderedHeightReport, renderedHeightReport } from './rendered-heights';

const ids = (...frameIds: string[]) => new Set(frameIds);

describe('renderedHeightReport', () => {
  it('reports new heights, rounded', () => {
    expect(renderedHeightReport(new Map(), new Map([['a', 67.6]]), ids('a'))).toEqual({ heights: { a: 68 } });
  });

  it('sends nothing when heights moved less than the tolerance', () => {
    const sent = new Map([['a', 68]]);
    expect(renderedHeightReport(sent, new Map([['a', 68 + RENDERED_HEIGHT_TOLERANCE - 1]]), ids('a'))).toBeUndefined();
    expect(renderedHeightReport(sent, new Map([['a', 68 + RENDERED_HEIGHT_TOLERANCE]]), ids('a'))).toEqual({
      heights: { a: 68 + RENDERED_HEIGHT_TOLERANCE },
    });
  });

  it('reports a shrink as well as a growth', () => {
    expect(renderedHeightReport(new Map([['a', 116]]), new Map([['a', 68]]), ids('a'))).toEqual({ heights: { a: 68 } });
  });

  it('forgets a frame whose story is no longer rendered (missing or error card)', () => {
    expect(renderedHeightReport(new Map([['a', 68]]), new Map([['a', null]]), ids('a'))).toEqual({
      heights: { a: null },
    });
    // Never reported, so nothing to forget.
    expect(renderedHeightReport(new Map(), new Map([['a', null]]), ids('a'))).toBeUndefined();
  });

  it('forgets frames that left the canvas and ignores heights of unknown frames', () => {
    expect(renderedHeightReport(new Map([['gone', 68]]), new Map([['stray', 50]]), ids('a'))).toEqual({
      heights: { gone: null },
    });
  });
});

describe('the first report after the board mounts', () => {
  it('replaces whatever an earlier page reported, with rendered heights only', () => {
    expect(
      renderedHeightReport(
        undefined,
        new Map<string, number | null>([
          ['a', 67.6],
          ['missing', null],
          ['stray', 50],
        ]),
        ids('a', 'missing'),
      ),
    ).toEqual({ heights: { a: 68 }, replace: true });
  });

  it('is sent even when no story has rendered, so stale heights are forgotten', () => {
    expect(renderedHeightReport(undefined, new Map([['a', null]]), ids('a'))).toEqual({ heights: {}, replace: true });
  });

  it('replaces what was sent', () => {
    expect(applyRenderedHeightReport(new Map([['old', 1]]), { heights: { a: 2 }, replace: true })).toEqual(
      new Map([['a', 2]]),
    );
  });
});

describe('applyRenderedHeightReport', () => {
  it('sets and deletes', () => {
    const next = applyRenderedHeightReport(
      new Map([
        ['a', 1],
        ['b', 2],
      ]),
      { heights: { a: null, c: 3 } },
    );
    expect(next).toEqual(
      new Map([
        ['b', 2],
        ['c', 3],
      ]),
    );
  });
});
