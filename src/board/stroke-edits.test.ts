import { describe, expect, it } from 'vitest';

import type { Stroke } from '../canvas-file';
import {
  NO_STROKE_EDITS,
  settleStrokeEdits,
  visibleStrokes,
  withAdded,
  withRemoveDone,
  withRemoved,
  withSaved,
  withoutAdded,
} from './stroke-edits';

const stroke = (id: string): Stroke => ({ id, color: '#f00', width: 2, points: [[0, 0]] });
const a = stroke('stroke-a');
const b = stroke('stroke-b');
const ids = (strokes: Stroke[]) => strokes.map((s) => s.id);

describe('stroke edits', () => {
  it('shows the file as is without edits', () => {
    const file = [a, b];
    expect(visibleStrokes(file, NO_STROKE_EDITS)).toBe(file);
  });

  it('shows a drawn stroke at once, then hands over to the file', () => {
    const local = stroke('local-1');
    let edits = withAdded(NO_STROKE_EDITS, local);
    expect(ids(visibleStrokes([a], edits))).toEqual(['stroke-a', 'local-1']);

    edits = withSaved(edits, 'local-1', b);
    expect(ids(visibleStrokes([a], edits))).toEqual(['stroke-a', 'stroke-b']);
    // The file catches up: no duplicate, and the edit is forgotten.
    expect(ids(visibleStrokes([a, b], edits))).toEqual(['stroke-a', 'stroke-b']);
    edits = settleStrokeEdits(edits, [a, b]);
    expect(edits.added.size).toBe(0);
  });

  it('hides an erased stroke until the file no longer has it', () => {
    let edits = withRemoved(NO_STROKE_EDITS, ['stroke-a']);
    expect(ids(visibleStrokes([a, b], edits))).toEqual(['stroke-b']);
    // The write has not finished, and the file has not changed yet: still hidden.
    expect(settleStrokeEdits(edits, [b])).toBe(edits);
    edits = withRemoveDone(edits, ['stroke-a'], true);
    // An old change event still has it: stays hidden.
    expect(ids(visibleStrokes([a, b], settleStrokeEdits(edits, [a, b])))).toEqual(['stroke-b']);
    edits = settleStrokeEdits(edits, [b]);
    expect(edits.removed.size).toBe(0);
  });

  it('shows the stroke again when erasing it failed', () => {
    let edits = withRemoved(NO_STROKE_EDITS, ['stroke-a', 'stroke-b']);
    edits = withRemoveDone(edits, ['stroke-a'], false);
    expect(ids(visibleStrokes([a, b], edits))).toEqual(['stroke-a']);
  });

  it('keeps a stroke erased before its save finished hidden under its real id', () => {
    let edits = withAdded(NO_STROKE_EDITS, stroke('local-1'));
    edits = withRemoved(edits, ['local-1']);
    expect(visibleStrokes([], edits)).toEqual([]);
    edits = withSaved(edits, 'local-1', b);
    expect(edits.removed.has('local-1')).toBe(false);
    expect(edits.removed.get('stroke-b')).toBe(false);
    expect(visibleStrokes([b], edits)).toEqual([]);
  });

  it('drops a failed add, and re-adding clears an erase', () => {
    let edits = withAdded(NO_STROKE_EDITS, stroke('local-1'));
    edits = withoutAdded(edits, 'local-1');
    expect(visibleStrokes([], edits)).toEqual([]);
    expect(withoutAdded(edits, 'nope')).toBe(edits);

    edits = withRemoved(NO_STROKE_EDITS, ['stroke-a']);
    edits = withAdded(edits, a);
    expect(ids(visibleStrokes([], edits))).toEqual(['stroke-a']);
  });
});
