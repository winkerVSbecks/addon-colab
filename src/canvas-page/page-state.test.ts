import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Channel } from 'storybook/internal/channels';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CanvasRequestError, requestCanvas } from '../channel';
import { registerCanvasChannel } from '../server/canvas-channel';
import { type CanvasStore, createCanvasStore } from '../server/canvas-store';
import { canvasPageStateFromError, initialCanvasPageState } from './page-state';

describe('canvas page state', () => {
  it('asks the server for a canvas id', () => {
    expect(initialCanvasPageState('design-review', true)).toBeNull();
  });

  it('shows the unsupported state without asking', () => {
    expect(initialCanvasPageState('design-review', false)).toEqual({ kind: 'unsupported' });
  });

  it('shows a file whose name is not a canvas id as invalid, not deleted', () => {
    expect(initialCanvasPageState('My Board!', true)).toMatchObject({
      kind: 'invalid',
      fileId: 'My Board!',
      errors: [expect.stringContaining('is not a canvas id')],
    });
  });

  it('maps errors for canvas ids', () => {
    expect(canvasPageStateFromError('board', new CanvasRequestError('gone', 'NOT_FOUND'))).toEqual({
      kind: 'missing',
      fileId: 'board',
    });
    expect(canvasPageStateFromError('board', new CanvasRequestError('bad', 'INVALID_FILE', ['x: wrong']))).toEqual({
      kind: 'invalid',
      fileId: 'board',
      errors: ['x: wrong'],
    });
    expect(canvasPageStateFromError('board', new CanvasRequestError('Timed out', 'TIMEOUT'))).toEqual({
      kind: 'error',
      message: 'Timed out',
    });
  });

  describe('with a real store', () => {
    let dir: string;
    let store: CanvasStore;
    let channel: Channel;
    let unregister: () => void;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'colab-page-state-'));
      store = createCanvasStore({ dir });
      channel = new Channel({});
      unregister = registerCanvasChannel(channel, store);
    });

    afterEach(async () => {
      unregister();
      await store.close();
      await rm(dir, { recursive: true, force: true });
    });

    it('shows an existing file named "My Board!.json" as invalid, although the server answers NOT_FOUND', async () => {
      await writeFile(join(dir, 'My Board!.json'), '{}', 'utf8');
      const error = await requestCanvas(channel, 'get', { id: 'My Board!' }).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ code: 'NOT_FOUND' });
      expect(canvasPageStateFromError('My Board!', error)).toMatchObject({ kind: 'invalid', fileId: 'My Board!' });
    });
  });
});
