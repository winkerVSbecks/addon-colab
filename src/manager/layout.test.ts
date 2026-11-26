import { describe, expect, it, vi } from 'vitest';

import { canvasStoryId } from '../canvas-entry';
import {
  ZOOM_RESET_SHORTCUT,
  hidePanelOnCanvases,
  installCanvasLayout,
  isShowingCanvas,
  ZOOM_TOOL_ID,
  hideZoomOnCanvases,
  resetStorybookZoom,
} from './layout';

type State = Parameters<ReturnType<typeof hidePanelOnCanvases>>[0];

const canvasId = canvasStoryId('board');
const state = (storyId: string | undefined, tags?: string[]) =>
  ({ storyId, index: storyId && tags ? { [storyId]: { id: storyId, tags } } : {} }) as unknown as State;

describe('addon panel on canvas pages', () => {
  it('recognises canvas pages by tag, or by id once the entry has left the index', () => {
    expect(isShowingCanvas(state(canvasId, ['colab-canvas']))).toBe(true);
    expect(isShowingCanvas(state(canvasId))).toBe(true);
    expect(isShowingCanvas(state('example-button--primary', ['dev']))).toBe(false);
    expect(isShowingCanvas(state(undefined))).toBe(false);
  });

  it('hides the panel on canvases and defers to Storybook (or a previous rule) elsewhere', () => {
    expect(hidePanelOnCanvases()(state(canvasId, ['colab-canvas']), true)).toBe(false);
    expect(hidePanelOnCanvases()(state('example-button--primary', ['dev']), true)).toBeUndefined();
    const previous = vi.fn(() => false);
    expect(hidePanelOnCanvases(previous)(state('example-button--primary', ['dev']), true)).toBe(false);
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it('keeps other layout customisations when installed', () => {
    const showSidebar = () => true;
    const config: { layoutCustomisations?: Record<string, unknown> } = { layoutCustomisations: { showSidebar } };
    installCanvasLayout({
      getConfig: () => config as never,
      setConfig: (next) => Object.assign(config, next),
    });
    expect(config.layoutCustomisations!.showSidebar).toBe(showSidebar);
    expect(typeof config.layoutCustomisations!.showPanel).toBe('function');
  });
});

describe("Storybook's own zoom on canvas pages", () => {
  it("is reset through the zoom tool's shortcut, and tolerates the shortcut being absent", () => {
    const action = vi.fn();
    expect(resetStorybookZoom({ getAddonsShortcuts: () => ({ [ZOOM_RESET_SHORTCUT]: { action } }) })).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    expect(resetStorybookZoom({ getAddonsShortcuts: () => ({}) })).toBe(false);
    expect(
      resetStorybookZoom({
        getAddonsShortcuts: () => {
          throw new Error('not ready');
        },
      }),
    ).toBe(false);
  });

  function setup(initialStoryId: string | undefined, toolbar?: Record<string, { hidden?: boolean; title?: string }>) {
    const action = vi.fn();
    const listeners = new Map<string, (storyId?: unknown) => void>();
    const config: { toolbar?: Record<string, { hidden?: boolean }> } = { toolbar };
    const setConfig = vi.fn((next: typeof config) => void Object.assign(config, next));
    let current = initialStoryId;
    hideZoomOnCanvases(
      {
        getAddonsShortcuts: () => ({ [ZOOM_RESET_SHORTCUT]: { action } }),
        on: (event, listener) => listeners.set(event, listener),
        getUrlState: () => ({ storyId: current }),
      },
      { getConfig: () => config, setConfig },
      ['storyChanged', 'storySpecified'],
    );
    return {
      action,
      config,
      setConfig,
      listeners,
      go: (storyId: string, event = 'storyChanged', withId = true) => {
        current = storyId;
        listeners.get(event)!(withId ? storyId : { storyId });
      },
    };
  }

  it('is hidden and reset while a canvas is open, and comes back on a story', () => {
    const t = setup('example-button--primary');
    expect([...t.listeners.keys()]).toEqual(['storyChanged', 'storySpecified']);
    expect(t.setConfig).not.toHaveBeenCalled();
    expect(t.action).not.toHaveBeenCalled();

    t.go(canvasId);
    expect(t.config.toolbar![ZOOM_TOOL_ID]).toEqual({ hidden: true });
    expect(t.action).toHaveBeenCalledTimes(1);

    // Another canvas: still hidden, no extra config write, zoom reset again.
    t.go(canvasStoryId('other'));
    expect(t.setConfig).toHaveBeenCalledTimes(1);
    expect(t.action).toHaveBeenCalledTimes(2);

    t.go('example-button--primary');
    expect(t.config.toolbar![ZOOM_TOOL_ID]).toEqual({ hidden: false });
    expect(t.action).toHaveBeenCalledTimes(2);
  });

  it('is hidden when the page opens on a canvas, and reads the URL when the event has no story id', () => {
    const t = setup(canvasId);
    expect(t.config.toolbar![ZOOM_TOOL_ID]).toEqual({ hidden: true });
    t.go('example-button--primary', 'storySpecified', false);
    expect(t.config.toolbar![ZOOM_TOOL_ID]).toEqual({ hidden: false });
  });

  it("keeps the project's own toolbar options", () => {
    const t = setup('example-button--primary', { zoom: { hidden: true, title: 'Zoom' }, remount: { hidden: true } });
    t.go(canvasId);
    t.go('example-button--primary');
    // The project had hidden zoom itself: it stays hidden after leaving the canvas.
    expect(t.config.toolbar).toEqual({ zoom: { hidden: true, title: 'Zoom' }, remount: { hidden: true } });
  });
});
