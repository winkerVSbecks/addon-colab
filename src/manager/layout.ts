/**
 * Manager layout on canvas pages: no addon panel, and Storybook's own zoom out of the way.
 *
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

/** The id of Storybook's toolbar zoom tool, and the key of its "Zoom to 100%" shortcut. */
export const ZOOM_TOOL_ID = 'zoom';
export const ZOOM_RESET_SHORTCUT = 'zoom-zoomReset';

interface ZoomApi {
  getAddonsShortcuts: () => Record<string, { action?: () => unknown } | undefined>;
}

/**
 * Sets Storybook's toolbar zoom back to 100%. The zoom level is kept across pages and scales the
 * preview iframe, so a canvas opened after zooming a story would stay scaled with no control to
 * undo it. The level has no API of its own; the zoom tool registers its reset as an addon shortcut,
 * which is called here. Does nothing if that shortcut is not there.
 */
export function resetStorybookZoom(api: ZoomApi): boolean {
  let action: (() => unknown) | undefined;
  try {
    action = api.getAddonsShortcuts()[ZOOM_RESET_SHORTCUT]?.action;
  } catch {
    return false;
  }
  if (typeof action !== 'function') return false;
  action();
  return true;
}

interface ToolbarItemConfig {
  hidden?: boolean;
}
type ToolbarConfig = Record<string, ToolbarItemConfig>;

interface ToolbarConfigApi {
  getConfig: () => { toolbar?: ToolbarConfig };
  setConfig: (config: { toolbar: ToolbarConfig }) => void;
}

interface StoryChangeApi extends ZoomApi {
  on: (event: string, listener: (storyId?: unknown) => void) => unknown;
  getUrlState: () => { storyId?: string };
}

/**
 * One zoom control on canvas pages (the board's). While a canvas is open, Storybook's toolbar zoom
 * is hidden with the documented `toolbar.<id>.hidden` manager option
 * (https://storybook.js.org/docs/configure/user-interface/features-and-behavior) and its level is
 * reset to 100%; on leaving the canvas the option goes back to what it was. `events` are the
 * manager events after which the open page may have changed. Returns the sync function.
 *
 * (The same option as a story parameter of the canvas entry was tried first: Storybook 11.0.0-rc.0
 * applies it on a full page load but not after navigating from the sidebar.)
 */
export function hideZoomOnCanvases(api: StoryChangeApi, addons: ToolbarConfigApi, events: string[]): () => void {
  let hiding = false;
  let previous: ToolbarItemConfig | undefined;
  const sync = (eventStoryId?: unknown) => {
    const storyId = typeof eventStoryId === 'string' ? eventStoryId : api.getUrlState().storyId;
    const onCanvas = !!storyId && isCanvasStoryId(storyId);
    if (onCanvas) resetStorybookZoom(api);
    if (onCanvas === hiding) return;
    hiding = onCanvas;
    const toolbar = addons.getConfig().toolbar ?? {};
    if (onCanvas) {
      previous = toolbar[ZOOM_TOOL_ID] as ToolbarItemConfig | undefined;
      addons.setConfig({ toolbar: { ...toolbar, [ZOOM_TOOL_ID]: { ...previous, hidden: true } } });
    } else {
      addons.setConfig({ toolbar: { ...toolbar, [ZOOM_TOOL_ID]: { ...previous, hidden: previous?.hidden ?? false } } });
    }
  };
  for (const event of events) api.on(event, sync);
  sync();
  return sync;
}
