/**
 * What the canvas page shows, as a pure function of its state, so every state has a story.
 * `CanvasPage` (the container) works out the state from the browser and the canvas channel.
 *
 * Messages use Storybook's `EmptyTabContent`, the component official addons (a11y, vitest) use for
 * empty and error states in their panels, so they match the manager in light and dark themes.
 */
import React, { type ReactNode } from 'react';

import { EmptyTabContent, Link, Loader } from 'storybook/internal/components';
import { styled } from 'storybook/theming/emotion';

import { type CanvasFile, isCanvasId } from '../canvas-file';
import { REQUIRED_BROWSER } from './support';

export type CanvasPageState =
  | { kind: 'unsupported' }
  | { kind: 'loading' }
  | { kind: 'ready'; canvas: CanvasFile }
  /** No such canvas file (never existed, or deleted while open). */
  | { kind: 'missing'; fileId: string }
  /** The file exists but is not a valid canvas. */
  | { kind: 'invalid'; fileId: string; errors: string[] }
  /** The canvas server did not answer (for example in a static build, or the dev server stopped). */
  | { kind: 'error'; message: string };

export interface CanvasPageViewProps {
  state: CanvasPageState;
  /** Renders the board for a loaded canvas; see `CanvasBoard`. */
  renderBoard: (canvas: CanvasFile) => ReactNode;
}

const Page = styled.div(({ theme }) => ({
  position: 'fixed',
  inset: 0,
  overflow: 'hidden',
  background: theme.background.content,
  color: theme.color.defaultText,
  fontFamily: theme.typography.fonts.base,
}));

/** Lays a message over the board without catching pointer events, so drops still reach the board. */
const Overlay = styled.div({
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  '& > div': { background: 'transparent' },
});

const Errors = styled.ul(({ theme }) => ({
  margin: '4px 0 0',
  padding: 0,
  listStyle: 'none',
  textAlign: 'left',
  fontFamily: theme.typography.fonts.mono,
  fontSize: theme.typography.size.s1,
  color: theme.color.defaultText,
  overflowWrap: 'anywhere',
  maxHeight: 160,
  overflowY: 'auto',
  '& li + li': { marginTop: 4 },
}));

const Code = styled.code(({ theme }) => ({
  fontFamily: theme.typography.fonts.mono,
  fontSize: '0.92em',
}));

function fileName(fileId: string) {
  return <Code>{`${fileId}.json`}</Code>;
}

export function CanvasPageView({ state, renderBoard }: CanvasPageViewProps) {
  switch (state.kind) {
    case 'unsupported':
      return (
        <Page data-colab-canvas-state="unsupported">
          <EmptyTabContent
            title={`Canvases need ${REQUIRED_BROWSER}`}
            description={`This canvas draws live stories with HTML-in-Canvas, which this browser does not support. Open Storybook in ${REQUIRED_BROWSER} to view and edit it. The canvas file is not changed.`}
            footer={
              <Link
                href="https://github.com/WICG/html-in-canvas"
                target="_blank"
                rel="noreferrer"
                withArrow
                cancel={false}
              >
                About HTML-in-Canvas
              </Link>
            }
          />
        </Page>
      );
    case 'loading':
      return (
        <Page data-colab-canvas-state="loading">
          <Loader />
        </Page>
      );
    case 'ready':
      return (
        <Page data-colab-canvas-state="ready">
          {renderBoard(state.canvas)}
          {state.canvas.frames.length === 0 && (
            <Overlay data-colab-canvas-empty="">
              <EmptyTabContent
                title={`${state.canvas.name} is empty`}
                description="Drag stories from the sidebar onto the canvas. Each one renders live: move and resize it, or press C and click any element in it to leave a comment."
              />
            </Overlay>
          )}
        </Page>
      );
    case 'missing':
      return (
        <Page data-colab-canvas-state="missing">
          <EmptyTabContent
            title="This canvas no longer exists"
            description={<>The file {fileName(state.fileId)} was deleted. Pick another canvas in the sidebar.</>}
          />
        </Page>
      );
    case 'invalid':
      return (
        <Page data-colab-canvas-state="invalid">
          <EmptyTabContent
            title="This canvas file can't be read"
            description={
              <>
                {isCanvasId(state.fileId) ? (
                  <>
                    Fix {fileName(state.fileId)} in the canvas folder, or delete it from the Canvases menu in the
                    toolbar.
                  </>
                ) : (
                  <>
                    Canvas file names must be lowercase words joined by dashes, such as <Code>design-review.json</Code>.
                    Rename or remove {fileName(state.fileId)} in the canvas folder.
                  </>
                )}
                <Errors aria-label="Problems in the file">
                  {state.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </Errors>
              </>
            }
          />
        </Page>
      );
    case 'error':
      return (
        <Page data-colab-canvas-state="error">
          <EmptyTabContent
            title="Couldn't load this canvas"
            description={`Canvases are served by the Storybook dev server (storybook dev). ${state.message}`}
          />
        </Page>
      );
  }
}
