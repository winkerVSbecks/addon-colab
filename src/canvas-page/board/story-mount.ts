/**
 * Renders a story into an element of the board, the way docs pages render several stories on one
 * page: `loadStory` + `renderStoryToElement` on the preview (`window.__STORYBOOK_PREVIEW__`). Both
 * are public methods of `PreviewWeb` in Storybook 11; the global itself is undocumented, so it is
 * typed here with only what the board uses. `storyStoreValue` is protected and not used.
 */

/** The parts of a prepared story the board reads. */
export interface PreparedStoryLike {
  id: string;
  title: string;
  name: string;
  parameters: Record<string, unknown>;
}

interface RenderCallbacks {
  showMain: () => void;
  showError: (error: { title: string; description: string }) => void;
  showException: (error: Error) => void;
}

export interface PreviewLike {
  loadStory: (selection: { storyId: string }) => Promise<PreparedStoryLike>;
  renderStoryToElement: (
    story: PreparedStoryLike,
    element: HTMLElement,
    callbacks: RenderCallbacks,
    options: { autoplay: boolean; forceInitialArgs: boolean },
  ) => () => Promise<void>;
}

export function getPreview(): PreviewLike | undefined {
  const preview = (globalThis as { __STORYBOOK_PREVIEW__?: Partial<PreviewLike> }).__STORYBOOK_PREVIEW__;
  if (preview && typeof preview.loadStory === 'function' && typeof preview.renderStoryToElement === 'function') {
    return preview as PreviewLike;
  }
  return undefined;
}

export type StoryStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; story: PreparedStoryLike }
  | { kind: 'error'; title: string; message: string; story?: PreparedStoryLike };

export interface StoryMount {
  /** Re-renders if the story's implementation changed (after hot reload of its file). */
  refresh: () => Promise<void>;
  /** Unmounts the story and stops its play function. Safe to call twice. */
  teardown: () => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Mounts `storyId` into `element` and reports its status. The story runs as in Storybook's canvas
 * (play functions included). `refresh` reloads the story and re-renders only when the prepared story
 * is a new object, which happens when its CSF file was hot-reloaded; component edits are picked up
 * by React Fast Refresh without this.
 */
export function mountStory(
  preview: PreviewLike,
  storyId: string,
  element: HTMLElement,
  onStatus: (status: StoryStatus) => void,
): StoryMount {
  let current: PreparedStoryLike | undefined;
  let teardownRender: (() => Promise<void>) | undefined;
  let disposed = false;
  // Mounts, refreshes and teardown run one after another, never interleaved.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task, task);
    return queue;
  };

  const render = async (story: PreparedStoryLike) => {
    if (teardownRender) {
      const previous = teardownRender;
      teardownRender = undefined;
      await previous().catch(() => undefined);
    }
    if (disposed) return;
    current = story;
    onStatus({ kind: 'ready', story });
    teardownRender = preview.renderStoryToElement(
      story,
      element,
      {
        showMain: () => undefined,
        showError: ({ title, description }) => onStatus({ kind: 'error', title, message: description, story }),
        showException: (error) =>
          onStatus({ kind: 'error', title: 'This story threw an error', message: messageOf(error), story }),
      },
      { autoplay: true, forceInitialArgs: false },
    );
  };

  const load = async (initial: boolean) => {
    if (disposed) return;
    let story: PreparedStoryLike;
    try {
      story = await preview.loadStory({ storyId });
    } catch (error) {
      if (initial) onStatus({ kind: 'error', title: `Couldn't load ${storyId}`, message: messageOf(error) });
      return;
    }
    if (disposed || (!initial && story === current)) return;
    await render(story);
  };

  onStatus({ kind: 'loading' });
  void enqueue(() => load(true));

  return {
    refresh: () => enqueue(() => load(false)),
    teardown: () => {
      disposed = true;
      return enqueue(async () => {
        const previous = teardownRender;
        teardownRender = undefined;
        await previous?.().catch(() => undefined);
      });
    },
  };
}
