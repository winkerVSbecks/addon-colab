/**
 * "Add to canvas": a toolbar button, shown while a story is open, whose menu lists the canvases.
 * Picking one adds the open story to it, to the right of its other stories. This is the way in when
 * dragging from the sidebar is awkward (a collapsed component, a trackpad, keyboard use).
 *
 * Built like the Canvases menu and Storybook's own zoom tool
 * (`code/core/src/manager/components/preview/tools/zoom.tsx`): a ghost `ToggleButton` opening a
 * `PopoverProvider` with an `ActionList`. Confirms with a manager notification, like the
 * notifications Storybook core and addon-vitest raise, whose click opens the canvas.
 */
import React, { useMemo, useState } from 'react';

import { ActionList, PopoverProvider, ToggleButton } from 'storybook/internal/components';
import { CategoryIcon, PlusIcon } from '@storybook/icons';
import { addons, useParameter, useStorybookApi, useStorybookState } from 'storybook/manager-api';
import { styled } from 'storybook/theming/emotion';

import { defaultFrameWidth, nextFramePosition } from '../board/frame-defaults';
import { canvasStoryId, isCanvasStoryId } from '../canvas-entry';
import { type CanvasSummary, type ChannelLike, requestCanvas } from '../channel';
import { useCanvasListing } from './use-canvas-listing';

const Container = styled.div({ minWidth: 240, maxWidth: 340 });

const Heading = styled.div(({ theme }) => ({
  padding: '8px 12px 4px',
  fontSize: theme.typography.size.s1,
  fontWeight: theme.typography.weight.bold,
  color: theme.textMutedColor,
}));

const Muted = styled.div(({ theme }) => ({
  padding: '8px 12px',
  fontSize: theme.typography.size.s2 - 1,
  color: theme.textMutedColor,
}));

const ScrollList = styled(ActionList)({ maxHeight: 320, overflowY: 'auto' });

/** Adds `storyId` to the canvas, placed after its other frames. Returns the new frame's id. */
export async function addStoryToCanvas(
  channel: ChannelLike,
  canvasId: string,
  storyId: string,
  parameters: Record<string, unknown> | undefined,
): Promise<string> {
  const canvas = await requestCanvas(channel, 'get', { id: canvasId });
  const at = nextFramePosition(canvas.frames);
  const { frame } = await requestCanvas(channel, 'addFrame', {
    canvasId,
    frame: { storyId, x: at.x, y: at.y, width: defaultFrameWidth(parameters) },
  });
  return frame.id;
}

export function AddToCanvasTool() {
  const api = useStorybookApi();
  const { storyId, viewMode } = useStorybookState();
  const layout = useParameter<string | undefined>('layout', undefined);
  const channel = useMemo(() => addons.getChannel() as ChannelLike, []);
  const listing = useCanvasListing(channel);
  const [open, setOpen] = useState(false);

  if (viewMode !== 'story' || !storyId || isCanvasStoryId(storyId)) return null;
  const canvases = listing.status === 'ready' ? listing.listing.canvases : [];
  const storyName = (() => {
    try {
      const entry = api.getData(storyId);
      return entry && 'title' in entry ? `${entry.title} › ${entry.name}` : storyId;
    } catch {
      return storyId;
    }
  })();

  const add = async (canvas: CanvasSummary) => {
    try {
      await addStoryToCanvas(channel, canvas.id, storyId, layout ? { layout } : undefined);
      api.addNotification({
        id: `addon-colab/added-${canvas.id}`,
        content: { headline: `Added to ${canvas.name}`, subHeadline: `${storyName}. Click to open the canvas.` },
        icon: <CategoryIcon />,
        duration: 6000,
        onClick: ({ onDismiss }) => {
          onDismiss();
          api.selectStory(canvasStoryId(canvas.id));
        },
      });
    } catch (error) {
      api.addNotification({
        id: `addon-colab/add-failed-${canvas.id}`,
        content: {
          headline: `Couldn't add to ${canvas.name}`,
          subHeadline: error instanceof Error ? error.message : String(error),
        },
        duration: 8000,
      });
    }
  };

  return (
    <PopoverProvider
      ariaLabel="Add to canvas"
      placement="bottom-end"
      padding={0}
      visible={open}
      onVisibleChange={setOpen}
      popover={({ onHide }) => (
        <Container>
          <Heading>Add this story to a canvas</Heading>
          {listing.status === 'loading' && <Muted>Loading canvases…</Muted>}
          {listing.status === 'error' && <Muted role="alert">Canvases need the Storybook dev server.</Muted>}
          {listing.status === 'ready' && canvases.length === 0 && (
            <Muted>No canvases yet. Create one from the Canvases menu in the toolbar.</Muted>
          )}
          {canvases.length > 0 && (
            <ScrollList aria-label="Canvases">
              {canvases.map((canvas) => (
                <ActionList.Item key={canvas.id}>
                  <ActionList.Action
                    ariaLabel={false}
                    onClick={() => {
                      onHide();
                      void add(canvas);
                    }}
                  >
                    <ActionList.Icon>
                      <CategoryIcon />
                    </ActionList.Icon>
                    <ActionList.Text>
                      <span>{canvas.name}</span>
                      <small>{`${canvas.id}.json`}</small>
                    </ActionList.Text>
                  </ActionList.Action>
                </ActionList.Item>
              ))}
            </ScrollList>
          )}
        </Container>
      )}
    >
      <ToggleButton
        padding="small"
        variant="ghost"
        ariaLabel="Add to canvas"
        tooltip="Add this story to a canvas"
        pressed={open}
      >
        <PlusIcon />
      </ToggleButton>
    </PopoverProvider>
  );
}
