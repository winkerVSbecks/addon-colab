import { describe, expect, it, vi } from 'vitest';

import {
  type PreparedStoryLike,
  type PreviewLike,
  RETRY_DELAYS,
  type StoryStatus,
  isMissingStoryError,
  mountStory,
} from './story-mount';

const element = {} as HTMLElement;
const storyOf = (name = 'Primary'): PreparedStoryLike => ({
  id: 'example-button--primary',
  title: 'Example/Button',
  name,
  parameters: {},
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A preview whose `loadStory` answers come from `next` (a story, an error, or a pending promise). */
function fakePreview(next: () => PreparedStoryLike | Error | Promise<PreparedStoryLike>) {
  const log: string[] = [];
  let renders = 0;
  const callbacks: Parameters<PreviewLike['renderStoryToElement']>[2][] = [];
  const preview: PreviewLike = {
    loadStory: async ({ storyId }) => {
      log.push(`load ${storyId}`);
      const result = next();
      if (result instanceof Error) throw result;
      return result;
    },
    renderStoryToElement: (story, target, cbs, options) => {
      renders += 1;
      const n = renders;
      expect(target).toBe(element);
      expect(options).toEqual({ autoplay: true, forceInitialArgs: false });
      callbacks.push(cbs);
      log.push(`render ${n} ${story.name}`);
      return async () => {
        log.push(`teardown ${n}`);
      };
    },
  };
  return { preview, log, callbacks };
}

function missingError() {
  const error = new Error("Couldn't find story matching id 'example-button--primary' after HMR.");
  error.name = 'SB_PREVIEW_API_0004 (MissingStoryAfterHmrError)';
  return error;
}

/** Lets the mount's queued work run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mountStory', () => {
  it('loads and renders the story once, reporting loading then ready', async () => {
    const story = storyOf();
    const { preview, log } = fakePreview(() => story);
    const statuses: StoryStatus[] = [];
    mountStory(preview, story.id, element, (status) => statuses.push(status));
    expect(statuses).toEqual([{ kind: 'loading' }]);
    await settle();
    expect(statuses).toEqual([{ kind: 'loading' }, { kind: 'ready', story }]);
    expect(log).toEqual(['load example-button--primary', 'render 1 Primary']);
  });

  it('refresh re-renders only when the prepared story is a new object', async () => {
    let story = storyOf();
    const { preview, log } = fakePreview(() => story);
    const statuses: StoryStatus[] = [];
    const mount = mountStory(preview, story.id, element, (status) => statuses.push(status));
    await settle();

    // Same prepared story (another file was hot-reloaded): loaded again, not rendered again.
    await mount.refresh();
    await mount.refresh();
    expect(log.filter((line) => line.startsWith('render'))).toEqual(['render 1 Primary']);
    expect(log.filter((line) => line.startsWith('teardown'))).toEqual([]);

    // A new prepared story (its CSF file was hot-reloaded): old render torn down first, then rendered.
    story = storyOf('Primary edited');
    await mount.refresh();
    expect(log.slice(-3)).toEqual(['load example-button--primary', 'teardown 1', 'render 2 Primary edited']);
    expect(statuses.at(-1)).toEqual({ kind: 'ready', story });
  });

  it('teardown unmounts the render, and is safe to call twice', async () => {
    const story = storyOf();
    const { preview, log } = fakePreview(() => story);
    const mount = mountStory(preview, story.id, element, () => undefined);
    await settle();
    await mount.teardown();
    await mount.teardown();
    expect(log.filter((line) => line.startsWith('teardown'))).toEqual(['teardown 1']);
    // Nothing happens after teardown.
    await mount.refresh();
    expect(log.filter((line) => line.startsWith('load'))).toHaveLength(1);
  });

  it('teardown during the initial load never renders the story', async () => {
    const story = storyOf();
    const loading = deferred<PreparedStoryLike>();
    const { preview, log } = fakePreview(() => loading.promise);
    const statuses: StoryStatus[] = [];
    const mount = mountStory(preview, story.id, element, (status) => statuses.push(status));
    await settle();
    const done = mount.teardown();
    loading.resolve(story);
    await done;
    expect(log).toEqual(['load example-button--primary']);
    expect(statuses).toEqual([{ kind: 'loading' }]);
  });

  it('teardown during a refresh tears down the old render and does not start a new one', async () => {
    let answer: PreparedStoryLike | Promise<PreparedStoryLike> = storyOf();
    const { preview, log } = fakePreview(() => answer);
    const mount = mountStory(preview, 'example-button--primary', element, () => undefined);
    await settle();
    const loading = deferred<PreparedStoryLike>();
    answer = loading.promise;
    void mount.refresh();
    await settle();
    const done = mount.teardown();
    loading.resolve(storyOf('Edited'));
    await done;
    expect(log.filter((line) => !line.startsWith('load'))).toEqual(['render 1 Primary', 'teardown 1']);
  });

  it('reports a story that is not in the index as missing, and mounts it when it appears', async () => {
    let answer: PreparedStoryLike | Error = missingError();
    const { preview, log } = fakePreview(() => answer);
    const statuses: StoryStatus[] = [];
    const mount = mountStory(preview, 'example-button--primary', element, (status) => statuses.push(status));
    await settle();
    expect(statuses).toEqual([{ kind: 'loading' }, { kind: 'missing' }]);
    expect(log).toEqual(['load example-button--primary']);

    answer = storyOf();
    await mount.refresh();
    expect(statuses.at(-1)).toEqual({ kind: 'ready', story: answer });
  });

  it('tears the render down when the story disappears after a hot reload', async () => {
    let answer: PreparedStoryLike | Error = storyOf();
    const { preview, log } = fakePreview(() => answer);
    const statuses: StoryStatus[] = [];
    const mount = mountStory(preview, 'example-button--primary', element, (status) => statuses.push(status));
    await settle();
    answer = missingError();
    await mount.refresh();
    expect(log.at(-1)).toBe('teardown 1');
    expect(statuses.at(-1)).toEqual({ kind: 'missing' });
  });

  it('reports other load failures as errors at first, and keeps a good render on a failed refresh', async () => {
    let answer: PreparedStoryLike | Error = new Error('Failed to fetch dynamically imported module');
    const first = fakePreview(() => answer);
    const statuses: StoryStatus[] = [];
    mountStory(first.preview, 'example-button--primary', element, (status) => statuses.push(status));
    await settle();
    expect(statuses.at(-1)).toEqual({
      kind: 'error',
      title: "This story couldn't be loaded",
      message: 'Failed to fetch dynamically imported module',
    });

    answer = storyOf();
    const second = fakePreview(() => answer);
    const later: StoryStatus[] = [];
    const mount = mountStory(second.preview, 'example-button--primary', element, (status) => later.push(status));
    await settle();
    answer = new Error('syntax error');
    await mount.refresh();
    expect(later.at(-1)?.kind).toBe('ready');
    expect(second.log.filter((line) => line.startsWith('teardown'))).toEqual([]);
  });

  it('passes render errors from Storybook on with the story', async () => {
    const story = storyOf();
    const { preview, callbacks } = fakePreview(() => story);
    const statuses: StoryStatus[] = [];
    mountStory(preview, story.id, element, (status) => statuses.push(status));
    await settle();
    callbacks[0]!.showException(new Error('boom'));
    expect(statuses.at(-1)).toEqual({ kind: 'error', title: 'This story threw an error', message: 'boom', story });
    callbacks[0]!.showError({ title: 'No render', description: 'details' });
    expect(statuses.at(-1)).toEqual({ kind: 'error', title: 'No render', message: 'details', story });
  });
});

describe('isMissingStoryError', () => {
  it("recognises Storybook's missing-story error by name or message", () => {
    expect(isMissingStoryError(missingError())).toBe(true);
    expect(isMissingStoryError(new Error("Couldn't find story matching id 'x' after HMR."))).toBe(true);
    expect(isMissingStoryError(new Error('Failed to fetch'))).toBe(false);
    expect(isMissingStoryError('nope')).toBe(false);
    expect(isMissingStoryError(null)).toBe(false);
  });
});

describe('mountStory retries a failed load', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('renders a story that reappears after a refresh first found it missing (deleted file restored)', async () => {
    vi.useFakeTimers();
    try {
      const story = storyOf();
      let answer: PreparedStoryLike | Error = story;
      const { preview, log } = fakePreview(() => answer);
      const statuses: string[] = [];
      const mount = mountStory(preview, story.id, element, (status) => statuses.push(status.kind));
      await vi.advanceTimersByTimeAsync(0);
      answer = missingError();
      void mount.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(statuses.at(-1)).toBe('missing');
      // The file is back, but nothing tells the board again.
      answer = story;
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS[0]!);
      await flush();
      expect(statuses.at(-1)).toBe('ready');
      expect(log.filter((line) => line.startsWith('render'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a failed first load, then gives up', async () => {
    vi.useFakeTimers();
    try {
      const { preview, log } = fakePreview(() => new TypeError('importers[path] is not a function'));
      const statuses: string[] = [];
      mountStory(preview, 'example-button--primary', element, (status) => statuses.push(status.kind));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(log.filter((line) => line.startsWith('load'))).toHaveLength(1 + RETRY_DELAYS.length);
      expect(statuses.at(-1)).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying after teardown', async () => {
    vi.useFakeTimers();
    try {
      const { preview, log } = fakePreview(() => missingError());
      const mount = mountStory(preview, 'example-button--primary', element, () => undefined);
      await vi.advanceTimersByTimeAsync(0);
      await mount.teardown();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(log.filter((line) => line.startsWith('load'))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
