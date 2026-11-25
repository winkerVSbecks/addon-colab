/**
 * The canvas page in the preview iframe: loads one canvas over the canvas channel, follows its
 * changes live, and shows the board or a message. Rendered by the preview decorator for canvas
 * entries (`parameters.colabCanvas`).
 */
import React, { useEffect, useState } from 'react';

import { type ChannelLike, onCanvasChanged, requestCanvas } from '../channel';
import { type ThemeChoice, StorybookThemeProvider, chooseCanvasTheme } from '../ui-theme';
import { CanvasBoard } from './CanvasBoard';
import { type CanvasPageState, CanvasPageView } from './CanvasPageView';
import { useManagerTheme } from './manager-theme';
import { canvasPageStateFromError, initialCanvasPageState } from './page-state';
import { supportsHtmlInCanvas } from './support';

export interface CanvasPageProps {
  /** The canvas file id (file name without `.json`). */
  fileId: string;
  channel: ChannelLike;
  /** Overrides the manager's theme (`parameters.colab.theme`). */
  theme?: ThemeChoice;
  /** Used until the manager says which theme it uses (`parameters.docs.theme`). */
  fallback?: ThemeChoice;
  /** For tests and stories; defaults to feature detection. */
  supported?: boolean;
}

export function useCanvasPageState(fileId: string, channel: ChannelLike, supported: boolean): CanvasPageState {
  const [state, setState] = useState<CanvasPageState>(
    () => initialCanvasPageState(fileId, supported) ?? { kind: 'loading' },
  );

  useEffect(() => {
    // Unsupported browsers and bad file names need no answer from the server.
    const initial = initialCanvasPageState(fileId, supported);
    if (initial) {
      setState(initial);
      return;
    }
    let active = true;
    // A change event that arrives before the first response is newer, so it wins.
    let changed = false;
    setState({ kind: 'loading' });
    const unsubscribe = onCanvasChanged(channel, (event) => {
      if (!active || event.id !== fileId) return;
      changed = true;
      if (event.type === 'changed') setState({ kind: 'ready', canvas: event.canvas });
      else if (event.type === 'deleted') setState({ kind: 'missing', fileId });
      else setState({ kind: 'invalid', fileId, errors: event.errors });
    });
    requestCanvas(channel, 'get', { id: fileId }).then(
      (canvas) => active && !changed && setState({ kind: 'ready', canvas }),
      (error) => active && !changed && setState(canvasPageStateFromError(fileId, error)),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [fileId, channel, supported]);

  return state;
}

export function CanvasPage({ fileId, channel, theme, fallback, supported = supportsHtmlInCanvas() }: CanvasPageProps) {
  const state = useCanvasPageState(fileId, channel, supported);
  const manager = useManagerTheme(channel);
  return (
    <StorybookThemeProvider theme={chooseCanvasTheme({ theme, manager, fallback })}>
      <CanvasPageView state={state} renderBoard={(canvas) => <CanvasBoard canvas={canvas} channel={channel} />} />
    </StorybookThemeProvider>
  );
}
