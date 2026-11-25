import { describe, expect, it, vi } from 'vitest';

import { canvasStoryId } from '../canvas-entry';
import { hidePanelOnCanvases, installCanvasLayout, isShowingCanvas } from './layout';

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
