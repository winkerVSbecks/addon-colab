/**
 * Hides the addon panel on canvas pages. Uses Storybook's documented `layoutCustomisations.showPanel`
 * manager option (https://storybook.js.org/docs/configure/user-interface/features-and-behavior),
 * which Storybook asks on every render with the manager state, and keeps any `showPanel` already set.
 *
 * A project that sets `layoutCustomisations` in its own `.storybook/manager` (loaded after addons)
 * replaces this; the canvas stub's parameters still disable Controls and Actions there.
 */
import type { API_LayoutCustomisations } from 'storybook/internal/types';

import { isCanvasEntry, isCanvasStoryId } from '../canvas-entry';

type ShowPanel = NonNullable<API_LayoutCustomisations['showPanel']>;
type LayoutState = Parameters<ShowPanel>[0];

/** Whether the manager is showing a canvas page. */
export function isShowingCanvas(state: Pick<LayoutState, 'storyId' | 'index'>): boolean {
  const { storyId, index } = state;
  if (!storyId) return false;
  const entry = index?.[storyId];
  return entry ? isCanvasEntry(entry as { tags?: string[] }) : isCanvasStoryId(storyId);
}

/** `showPanel` that hides the panel on canvas pages and otherwise defers to `previous`. */
export function hidePanelOnCanvases(previous?: ShowPanel): ShowPanel {
  return (state, defaultValue) => (isShowingCanvas(state) ? false : previous?.(state, defaultValue));
}

interface ConfigApi {
  getConfig: () => { layoutCustomisations?: API_LayoutCustomisations };
  setConfig: (config: { layoutCustomisations: API_LayoutCustomisations }) => void;
}

/** Installs `hidePanelOnCanvases` into the manager config, keeping other layout customisations. */
export function installCanvasLayout(addons: ConfigApi): void {
  const current = addons.getConfig().layoutCustomisations ?? {};
  addons.setConfig({ layoutCustomisations: { ...current, showPanel: hidePanelOnCanvases(current.showPanel) } });
}
