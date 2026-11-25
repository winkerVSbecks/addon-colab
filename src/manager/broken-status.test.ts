import { Channel } from 'storybook/internal/channels';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canvasStoryId } from '../canvas-entry';
import { createCanvasFile, serializeCanvasFile } from '../canvas-file';
import { registerCanvasChannel } from '../server/canvas-channel';
import { type CanvasStore, createCanvasStore } from '../server/canvas-store';
import { BROKEN_CANVAS_STATUS, brokenCanvasStatuses, trackBrokenCanvases } from './broken-status';

vi.mock('storybook/manager-api', () => ({ experimental_getStatusStore: vi.fn() }));

describe('broken canvas statuses', () => {
  it('gives each unreadable file a warning on its sidebar entry', () => {
    const statuses = brokenCanvasStatuses({
      canvases: [],
      invalid: [
        { id: 'broken', file: 'broken.json', errors: ['schemaVersion: required'] },
        { id: 'My Board!', file: 'My Board!.json', errors: ['file name: bad'] },
      ],
    });
    expect(statuses).toEqual([
      expect.objectContaining({
        storyId: canvasStoryId('broken'),
        typeId: BROKEN_CANVAS_STATUS,
        value: 'status-value:warning',
        description: 'broken.json: schemaVersion: required',
      }),
      expect.objectContaining({ storyId: canvasStoryId('My Board!') }),
    ]);
  });

  describe('with a real store', () => {
    let dir: string;
    let store: CanvasStore;
    let channel: Channel;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'colab-status-'));
      store = createCanvasStore({ dir });
      channel = new Channel({});
      registerCanvasChannel(channel, store);
    });

    afterEach(async () => {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    });

    it('sets statuses from the canvas list', async () => {
      await writeFile(join(dir, 'ok.json'), serializeCanvasFile(createCanvasFile({ id: 'ok', name: 'Ok' })));
      await writeFile(join(dir, 'broken.json'), '{');
      const statusStore = { set: vi.fn(), unset: vi.fn() };
      const stop = trackBrokenCanvases(channel, statusStore);
      await vi.waitFor(() => expect(statusStore.set).toHaveBeenCalled());
      expect(statusStore.unset).toHaveBeenCalled();
      expect(statusStore.set.mock.calls[0]![0].map((status: { storyId: string }) => status.storyId)).toEqual([
        canvasStoryId('broken'),
      ]);
      stop();
    });
  });
});
