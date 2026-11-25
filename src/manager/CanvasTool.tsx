/**
 * The Canvases toolbar tool: a menu button (like Storybook's zoom tool) that opens `CanvasMenu`, plus
 * the dialogs it starts. Canvases themselves are listed and opened from the sidebar too, where each
 * canvas is an entry under "Canvases".
 */
import React, { useMemo, useState } from 'react';

import { PopoverProvider, ToggleButton } from 'storybook/internal/components';
import { CategoryIcon } from '@storybook/icons';
import { addons, useStorybookApi, useStorybookState } from 'storybook/manager-api';

import { canvasStoryId } from '../canvas-entry';
import { type CanvasSummary, type ChannelLike, type InvalidCanvas, requestCanvas } from '../channel';
import { CanvasDeleteDialog, CanvasNameDialog } from './CanvasDialogs';
import { CanvasMenu } from './CanvasMenu';
import { leaveCanvas, openCanvas } from './navigation';
import { useCanvasListing } from './use-canvas-listing';

type Dialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; canvas: CanvasSummary }
  | { kind: 'delete'; canvas?: CanvasSummary; invalid?: InvalidCanvas };

export function CanvasTool() {
  const api = useStorybookApi();
  const { storyId } = useStorybookState();
  const channel = useMemo(() => addons.getChannel() as ChannelLike, []);
  const listing = useCanvasListing(channel);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const close = (open: boolean) => !open && setDialog({ kind: 'none' });

  const currentFileId = useMemo(() => {
    if (listing.status !== 'ready' || !storyId) return undefined;
    const { canvases, invalid } = listing.listing;
    return [...canvases, ...invalid].find((item) => canvasStoryId(item.id) === storyId)?.id;
  }, [listing, storyId]);

  const deleting = dialog.kind === 'delete' ? (dialog.canvas ?? dialog.invalid) : undefined;

  return (
    <>
      <PopoverProvider
        ariaLabel="Canvases"
        placement="bottom-end"
        padding={0}
        visible={menuOpen}
        onVisibleChange={setMenuOpen}
        popover={({ onHide }) => (
          <CanvasMenu
            listing={listing}
            currentFileId={currentFileId}
            onOpen={(fileId) => {
              onHide();
              api.selectStory(canvasStoryId(fileId));
            }}
            onNew={() => {
              onHide();
              setDialog({ kind: 'create' });
            }}
            onRename={(canvas) => {
              onHide();
              setDialog({ kind: 'rename', canvas });
            }}
            onDelete={(target) => {
              onHide();
              setDialog({ kind: 'delete', ...target });
            }}
          />
        )}
      >
        <ToggleButton
          padding="small"
          variant="ghost"
          ariaLabel="Canvases"
          tooltip="Canvases: new, rename, delete"
          pressed={menuOpen}
        >
          <CategoryIcon />
        </ToggleButton>
      </PopoverProvider>

      <CanvasNameDialog
        mode="create"
        open={dialog.kind === 'create'}
        onOpenChange={close}
        onSubmit={async (name) => {
          const canvas = await requestCanvas(channel, 'create', { name });
          void openCanvas(api, canvas.id);
        }}
      />
      <CanvasNameDialog
        mode="rename"
        open={dialog.kind === 'rename'}
        initialName={dialog.kind === 'rename' ? dialog.canvas.name : ''}
        onOpenChange={close}
        onSubmit={(name) =>
          dialog.kind === 'rename'
            ? requestCanvas(channel, 'rename', { id: dialog.canvas.id, name })
            : Promise.resolve()
        }
      />
      <CanvasDeleteDialog
        open={dialog.kind === 'delete'}
        onOpenChange={close}
        fileId={deleting?.id ?? ''}
        name={dialog.kind === 'delete' ? (dialog.canvas?.name ?? dialog.invalid?.file ?? '') : ''}
        counts={
          dialog.kind === 'delete' && dialog.canvas
            ? { frames: dialog.canvas.frameCount, comments: dialog.canvas.commentCount }
            : undefined
        }
        onConfirm={async () => {
          if (!deleting) return;
          // Leave the page first: Storybook shows an error screen when the open entry disappears.
          await leaveCanvas(api, deleting.id);
          await requestCanvas(channel, 'delete', { id: deleting.id });
        }}
      />
    </>
  );
}
