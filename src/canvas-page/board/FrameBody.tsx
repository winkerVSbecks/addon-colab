/**
 * One story on the board: a `drawable` child of the board's canvas with the story rendered live
 * inside it. The canvas decides where it is drawn, so this element only knows its size. It mounts
 * the story once per story id; moves, resizes and file changes re-render this component without
 * remounting the story. Unmounting (frame removed) tears the story down.
 */
import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from 'storybook/internal/components';
import { styled } from 'storybook/theming/emotion';

import { MIN_FRAME_HEIGHT, type StoryLayout, storyLayout } from '../../board/frame-defaults';
import { DRAWABLE_ATTRIBUTE } from './html-in-canvas';
import { type PreviewLike, type StoryMount, type StoryStatus, mountStory } from './story-mount';

export interface FrameBodyProps {
  frameId: string;
  storyId: string;
  width: number;
  height?: number;
  preview: PreviewLike;
  /** Registers the element the canvas draws (null on unmount). */
  onElement: (frameId: string, element: HTMLDivElement | null) => void;
  /**
   * The frame's height in CSS pixels, whenever it changes. `rendered` is false while the story is
   * loading, missing or failed, so the height is that of a placeholder or message, not the story.
   */
  onMeasure: (frameId: string, height: number, rendered: boolean) => void;
  onStatus: (frameId: string, status: StoryStatus) => void;
  /** Removes this frame from the canvas (offered when its story no longer exists). */
  onRemove: (frameId: string) => void;
  /** Bumped by the board after a hot reload, so the story re-renders if its file changed. */
  refreshKey: number;
}

/**
 * Stories render in docs mode here, which skips Storybook's `layout` padding (`sb-main-padded`,
 * `sb-main-centered`), so the frame applies the same rules itself.
 */
const LAYOUT_STYLES: Record<StoryLayout, React.CSSProperties> = {
  padded: { padding: '1rem' },
  centered: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    boxSizing: 'border-box',
  },
  fullscreen: {},
};

const Body = styled.div({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  overflow: 'clip',
  // Stories are drawn on the canvas page's own background (the preview's default white), not the
  // Storybook UI theme, the same as in Storybook's own canvas.
  background: '#ffffff',
  color: '#2e3438',
});

const StoryRoot = styled.div({
  boxSizing: 'border-box',
  flex: '1 0 auto',
});

const Message = styled.div(({ theme }) => ({
  padding: 16,
  fontFamily: theme.typography.fonts.base,
  fontSize: theme.typography.size.s2,
  lineHeight: '20px',
  color: theme.color.darkest,
  background: theme.background.negative,
  '& strong': { display: 'block', color: theme.color.negativeText, marginBottom: 4 },
  '& pre': {
    margin: 0,
    whiteSpace: 'pre-wrap',
    fontFamily: theme.typography.fonts.mono,
    fontSize: theme.typography.size.s1,
  },
}));

/** Shown in place of a story that is not in this Storybook any more. Follows the Storybook theme. */
const Missing = styled.div(({ theme }) => ({
  flex: '1 0 auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  padding: 16,
  fontFamily: theme.typography.fonts.base,
  fontSize: theme.typography.size.s2,
  lineHeight: '20px',
  color: theme.color.defaultText,
  background: theme.background.content,
  '& strong': { fontWeight: theme.typography.weight.bold },
  '& code': {
    fontFamily: theme.typography.fonts.mono,
    fontSize: theme.typography.size.s1,
    color: theme.textMutedColor,
    overflowWrap: 'anywhere',
    marginBottom: 8,
  },
}));

function FrameBodyImpl({
  frameId,
  storyId,
  width,
  height,
  preview,
  onElement,
  onMeasure,
  onStatus,
  onRemove,
  refreshKey,
}: FrameBodyProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<StoryMount | null>(null);
  const [status, setStatus] = useState<StoryStatus>({ kind: 'loading' });
  const callbacks = useRef({ onStatus, onMeasure });
  callbacks.current = { onStatus, onMeasure };

  useLayoutEffect(() => {
    // Set here rather than as a prop: emotion's styled() drops attributes it does not know.
    bodyRef.current?.setAttribute(DRAWABLE_ATTRIBUTE, '');
    onElement(frameId, bodyRef.current);
    return () => onElement(frameId, null);
  }, [frameId, onElement]);

  // Mount the story once per story id; tear it down when the frame goes away.
  useEffect(() => {
    const element = storyRef.current;
    if (!element) return;
    const mount = mountStory(preview, storyId, element, (next) => {
      setStatus(next);
      callbacks.current.onStatus(frameId, next);
    });
    mountRef.current = mount;
    return () => {
      mountRef.current = null;
      void mount.teardown();
    };
  }, [preview, storyId, frameId]);

  useEffect(() => {
    if (refreshKey > 0) void mountRef.current?.refresh();
  }, [refreshKey]);

  const rendered = status.kind === 'ready';
  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const report = () => callbacks.current.onMeasure(frameId, element.offsetHeight, rendered);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [frameId, rendered]);

  const layout = status.kind === 'ready' ? storyLayout(status.story.parameters) : 'padded';

  return (
    <Body
      ref={bodyRef}
      data-colab-frame={frameId}
      data-story-id={storyId}
      style={{ width, minHeight: height ?? MIN_FRAME_HEIGHT }}
    >
      <StoryRoot
        ref={storyRef}
        // Comment selectors are relative to this element (src/board/element-target.ts).
        data-colab-story-root={storyId}
        style={status.kind === 'missing' ? { display: 'none' } : LAYOUT_STYLES[layout]}
      />
      {status.kind === 'missing' && (
        <Missing data-colab-frame-missing="">
          <strong>This story no longer exists</strong>
          <code>{storyId}</code>
          <Button variant="outline" size="small" ariaLabel={false} onClick={() => onRemove(frameId)}>
            Remove
          </Button>
        </Missing>
      )}
      {status.kind === 'error' && (
        <Message role="alert">
          <strong>{status.title}</strong>
          <pre>{status.message}</pre>
        </Message>
      )}
    </Body>
  );
}

export const FrameBody = memo(FrameBodyImpl);
