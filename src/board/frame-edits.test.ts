import { describe, expect, it } from 'vitest';

import type { Frame } from '../canvas-file';
import {
  type FrameEdits,
  applyFrameEdits,
  dropEdit,
  markSaved,
  markSaving,
  settleFrameEdits,
  withLiveEdit,
} from './frame-edits';

const frameA: Frame = { id: 'frame_a', storyId: 'example-button--primary', x: 0, y: 0, width: 360 };
const frameB: Frame = { id: 'frame_b', storyId: 'example-header--logged-in', x: 500, y: 0, width: 960, height: 80 };
const empty: FrameEdits = new Map();

describe('frame edits', () => {
  it('shows a live move on top of the file', () => {
    const edits = withLiveEdit(empty, 'frame_a', { x: 40, y: 50 });
    expect(applyFrameEdits([frameA, frameB], edits)).toEqual([{ ...frameA, x: 40, y: 50 }, frameB]);
  });

  it('merges successive live changes of one frame', () => {
    let edits = withLiveEdit(empty, 'frame_b', { x: 1 });
    edits = withLiveEdit(edits, 'frame_b', { y: 2 });
    edits = withLiveEdit(edits, 'frame_b', { height: null });
    const [, b] = applyFrameEdits([frameA, frameB], edits);
    expect(b).toEqual({ id: 'frame_b', storyId: frameB.storyId, x: 1, y: 2, width: 960 });
  });

  it('hides a frame whose removal is pending', () => {
    const edits = withLiveEdit(empty, 'frame_a', { removed: true });
    expect(applyFrameEdits([frameA, frameB], edits)).toEqual([frameB]);
  });

  it('does not snap back when the file reports an older state before the write lands', () => {
    let edits: FrameEdits = withLiveEdit(empty, 'frame_a', { x: 300 });
    const saving = markSaving(edits, 'frame_a');
    edits = saving.edits;
    // A remote change (e.g. an agent comment) arrives while the write is in flight.
    edits = settleFrameEdits(edits, [frameA], '2026-11-25T10:00:00.000Z');
    expect(applyFrameEdits([frameA], edits)[0]!.x).toBe(300);
    // The response arrives first, then the change event for that same write.
    edits = markSaved(edits, 'frame_a', saving.revision!, '2026-11-25T10:00:01.000Z');
    edits = settleFrameEdits(edits, [frameA], '2026-11-25T10:00:00.500Z');
    expect(applyFrameEdits([frameA], edits)[0]!.x).toBe(300);
    // Once the file is as new as the write, the edit is gone and the file is shown as is.
    const saved = { ...frameA, x: 300 };
    edits = settleFrameEdits(edits, [saved], '2026-11-25T10:00:01.000Z');
    expect(edits.size).toBe(0);
    expect(applyFrameEdits([saved], edits)).toEqual([saved]);
  });

  it('lets a newer edit outlive the response of an older write', () => {
    let edits: FrameEdits = withLiveEdit(empty, 'frame_a', { x: 100 });
    const first = markSaving(edits, 'frame_a');
    edits = withLiveEdit(first.edits, 'frame_a', { x: 200 });
    edits = markSaved(edits, 'frame_a', first.revision!, '2026-11-25T10:00:01.000Z');
    edits = settleFrameEdits(edits, [{ ...frameA, x: 100 }], '2026-11-25T10:00:01.000Z');
    expect(applyFrameEdits([{ ...frameA, x: 100 }], edits)[0]!.x).toBe(200);
  });

  it('drops an edit when its write fails, unless a newer edit replaced it', () => {
    const edits = withLiveEdit(empty, 'frame_a', { x: 100 });
    const saving = markSaving(edits, 'frame_a');
    expect(dropEdit(saving.edits, 'frame_a', saving.revision).size).toBe(0);
    const newer = withLiveEdit(saving.edits, 'frame_a', { x: 5 });
    expect(dropEdit(newer, 'frame_a', saving.revision).size).toBe(1);
  });

  it('forgets edits of frames that left the file (removal landed, or removed elsewhere)', () => {
    let edits: FrameEdits = withLiveEdit(empty, 'frame_a', { removed: true });
    edits = withLiveEdit(edits, 'frame_b', { x: 9 });
    edits = settleFrameEdits(edits, [frameB], '2026-11-25T10:00:00.000Z');
    expect([...edits.keys()]).toEqual(['frame_b']);
  });

  it('returns the same map when nothing settles, so callers can skip a re-render', () => {
    const edits = withLiveEdit(empty, 'frame_a', { x: 1 });
    expect(settleFrameEdits(edits, [frameA], '2030-01-01T00:00:00.000Z')).toBe(edits);
  });
});
