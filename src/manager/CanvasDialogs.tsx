/**
 * Dialogs for naming and deleting canvases. Built like Storybook's own "Create new story" dialog
 * (`code/core/src/controls/components/SaveStory.tsx`): `Modal` + `Form`, a `Form.Input`, solid
 * primary action, `Modal.Close` for cancel and `Modal.Error` for server errors.
 */
import React, { useEffect, useRef, useState } from 'react';

import { Button, Form, Modal } from 'storybook/internal/components';
import { styled } from 'storybook/theming/emotion';

import { deleteContents } from './wording';

const NameInput = styled(Form.Input)(({ theme }) => ({
  '::placeholder': { color: theme.color.mediumdark },
}));

const Strong = styled.strong(({ theme }) => ({
  fontWeight: theme.typography.weight.bold,
  overflowWrap: 'anywhere',
}));

const DeleteButton = styled(Button)(({ theme }) => ({
  // Storybook's Button has no destructive variant; tint the solid button with the theme's negative colour.
  '&&': { background: theme.color.negative, color: theme.color.lightest },
  '&&:hover:not(:disabled)': { background: theme.color.negativeText },
}));

const Code = styled.code(({ theme }) => ({
  fontFamily: theme.typography.fonts.mono,
  fontSize: '0.92em',
}));

/** Runs an async action and keeps its pending and error state for a dialog. */
function useSubmit(open: boolean) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPending(false);
      setError(null);
    }
  }, [open]);
  const run = async (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return { pending, error, run };
}

export interface CanvasNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'rename';
  /** Current name when renaming. */
  initialName?: string;
  /** Resolves when done (the dialog closes itself through `onOpenChange`), rejects with a message to show. */
  onSubmit: (name: string) => Promise<unknown>;
}

export function CanvasNameDialog({ open, onOpenChange, mode, initialName = '', onSubmit }: CanvasNameDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const { pending, error, run } = useSubmit(open);
  const creating = mode === 'create';
  const title = creating ? 'New canvas' : 'Rename canvas';
  const trimmed = name.trim();
  const unchanged = !creating && trimmed === initialName.trim();

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    const timer = setTimeout(() => inputRef.current?.select(), 0);
    return () => clearTimeout(timer);
  }, [open, initialName]);

  return (
    <Modal ariaLabel={title} width={360} open={open} onOpenChange={onOpenChange}>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed || unchanged) return;
          void run(async () => {
            await onSubmit(trimmed);
            onOpenChange(false);
          });
        }}
      >
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{title}</Modal.Title>
            <Modal.Description>
              {creating
                ? 'A canvas is a board for arranging live stories, commenting on them and sketching. It is saved as a JSON file in the canvas folder.'
                : 'Only the name changes. The file name and the link to this canvas stay the same.'}
            </Modal.Description>
          </Modal.Header>
          <NameInput
            ref={inputRef}
            aria-label="Canvas name"
            placeholder="Canvas name, e.g. Checkout review"
            value={name}
            maxLength={200}
            readOnly={pending}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
          />
          <Modal.Actions>
            <Button
              ariaLabel={false}
              type="submit"
              variant="solid"
              size="medium"
              disabled={pending || !trimmed || unchanged}
            >
              {creating ? 'Create' : 'Rename'}
            </Button>
            <Modal.Close asChild>
              <Button ariaLabel={false} type="reset" size="medium" disabled={pending}>
                Cancel
              </Button>
            </Modal.Close>
          </Modal.Actions>
        </Modal.Content>
      </Form>
      {error && <Modal.Error>{error}</Modal.Error>}
    </Modal>
  );
}

export interface CanvasDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name, or the file name for a broken canvas. */
  name: string;
  fileId: string;
  /** Counts for the warning; omitted for a broken canvas. */
  counts?: { frames: number; comments: number };
  onConfirm: () => Promise<unknown>;
}

export function CanvasDeleteDialog({ open, onOpenChange, name, fileId, counts, onConfirm }: CanvasDeleteDialogProps) {
  const { pending, error, run } = useSubmit(open);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const contents = deleteContents(counts);

  // The modal focuses its first button (Delete). Start on Cancel, so Enter does not delete by accident.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <Modal ariaLabel="Delete canvas" width={380} open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Delete canvas?</Modal.Title>
          <Modal.Description>
            <Strong>{name}</Strong>
            {contents} will be deleted, and its file <Code>{`${fileId}.json`}</Code> removed. This can&apos;t be undone
            from Storybook.
          </Modal.Description>
        </Modal.Header>
        <Modal.Actions>
          <DeleteButton
            ariaLabel={false}
            variant="solid"
            size="medium"
            disabled={pending}
            onClick={() =>
              run(async () => {
                await onConfirm();
                onOpenChange(false);
              })
            }
          >
            Delete canvas
          </DeleteButton>
          <Modal.Close asChild>
            <Button ref={cancelRef} ariaLabel={false} size="medium" disabled={pending}>
              Cancel
            </Button>
          </Modal.Close>
        </Modal.Actions>
      </Modal.Content>
      {error && <Modal.Error>{error}</Modal.Error>}
    </Modal>
  );
}
