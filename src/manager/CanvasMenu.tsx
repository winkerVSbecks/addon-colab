/**
 * The Canvases toolbar menu: actions for the open canvas, every canvas (with counts, and broken files
 * marked), and "New canvas". Built from `ActionList` like Storybook's own toolbar and sidebar menus
 * (`code/core/src/manager/components/preview/tools/zoom.tsx`, `.../sidebar/Menu.tsx`).
 */
import React from 'react';

import { ActionList } from 'storybook/internal/components';
import { AlertIcon, CategoryIcon, EditIcon, PlusIcon, TrashIcon } from '@storybook/icons';
import { styled } from 'storybook/theming/emotion';

import { canvasNameKey } from '../canvas-entry';
import { isCanvasId } from '../canvas-file';
import type { CanvasSummary, InvalidCanvas } from '../channel';
import type { CanvasListingState } from './use-canvas-listing';
import { canvasDetails, duplicateNames } from './wording';

export interface CanvasMenuProps {
  listing: CanvasListingState;
  /** File id of the canvas being shown, if any. */
  currentFileId?: string;
  onOpen: (fileId: string) => void;
  onNew: () => void;
  onRename: (canvas: CanvasSummary) => void;
  onDelete: (target: { canvas?: CanvasSummary; invalid?: InvalidCanvas }) => void;
}

const Container = styled.div({
  minWidth: 260,
  maxWidth: 340,
});

const ScrollList = styled(ActionList)({
  maxHeight: 320,
  overflowY: 'auto',
});

const Muted = styled.div(({ theme }) => ({
  padding: '8px 12px',
  fontSize: theme.typography.size.s2 - 1,
  color: theme.textMutedColor,
}));

const Warning = styled(AlertIcon)(({ theme }) => ({ color: theme.color.warning }));

export function CanvasMenu({ listing, currentFileId, onOpen, onNew, onRename, onDelete }: CanvasMenuProps) {
  const canvases = listing.status === 'ready' ? listing.listing.canvases : [];
  const invalid = listing.status === 'ready' ? listing.listing.invalid : [];
  const current = canvases.find((canvas) => canvas.id === currentFileId);
  const duplicates = duplicateNames(canvases);
  // The store can only delete files named like a canvas id; others must be removed by hand.
  const currentInvalid = invalid.find((file) => file.id === currentFileId && isCanvasId(file.id));

  return (
    <Container>
      {(current || currentInvalid) && (
        <ActionList aria-label="This canvas">
          {current && (
            <ActionList.Item>
              <ActionList.Action ariaLabel={false} onClick={() => onRename(current)}>
                <ActionList.Icon>
                  <EditIcon />
                </ActionList.Icon>
                <ActionList.Text>Rename canvas…</ActionList.Text>
              </ActionList.Action>
            </ActionList.Item>
          )}
          <ActionList.Item>
            <ActionList.Action
              ariaLabel={false}
              onClick={() => onDelete(current ? { canvas: current } : { invalid: currentInvalid })}
            >
              <ActionList.Icon>
                <TrashIcon />
              </ActionList.Icon>
              <ActionList.Text>Delete canvas…</ActionList.Text>
            </ActionList.Action>
          </ActionList.Item>
        </ActionList>
      )}

      {listing.status === 'loading' && <Muted>Loading canvases…</Muted>}
      {listing.status === 'error' && (
        <Muted role="alert">
          Can&apos;t reach the canvas server. Canvases need the Storybook dev server. ({listing.message})
        </Muted>
      )}
      {listing.status === 'ready' && canvases.length + invalid.length === 0 && (
        <Muted>No canvases yet. Create one to arrange live stories side by side.</Muted>
      )}
      {canvases.length + invalid.length > 0 && (
        <ScrollList aria-label="Canvases">
          {canvases.map((canvas) => (
            <ActionList.Item key={canvas.id} active={canvas.id === currentFileId}>
              <ActionList.Action
                ariaLabel={false}
                aria-current={canvas.id === currentFileId ? 'page' : undefined}
                onClick={() => onOpen(canvas.id)}
              >
                <ActionList.Icon>
                  <CategoryIcon />
                </ActionList.Icon>
                <ActionList.Text>
                  <span>{canvas.name}</span>
                  <small>{canvasDetails(canvas, { showFile: duplicates.has(canvasNameKey(canvas.name)) })}</small>
                </ActionList.Text>
              </ActionList.Action>
            </ActionList.Item>
          ))}
          {invalid.map((file) => (
            <ActionList.Item key={`invalid:${file.file}`} active={file.id === currentFileId}>
              <ActionList.Action
                ariaLabel={false}
                aria-current={file.id === currentFileId ? 'page' : undefined}
                onClick={() => onOpen(file.id)}
              >
                <ActionList.Icon>
                  <Warning />
                </ActionList.Icon>
                <ActionList.Text>
                  <span>{file.file}</span>
                  <small>Can&apos;t be read</small>
                </ActionList.Text>
              </ActionList.Action>
            </ActionList.Item>
          ))}
        </ScrollList>
      )}

      <ActionList>
        <ActionList.Item>
          <ActionList.Action ariaLabel={false} onClick={onNew} disabled={listing.status === 'error'}>
            <ActionList.Icon>
              <PlusIcon />
            </ActionList.Icon>
            <ActionList.Text>New canvas…</ActionList.Text>
          </ActionList.Action>
        </ActionList.Item>
      </ActionList>
    </Container>
  );
}
