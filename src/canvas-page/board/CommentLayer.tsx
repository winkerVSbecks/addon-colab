/**
 * Everything comments draw on the board, above the stories and the mode layer:
 * - the hover highlight in comment mode (styled after Storybook's highlight feature,
 *   `code/core/src/highlight/utils.ts`: a 2px outline in the secondary colour);
 * - one pin per comment (user and agent pins look different; detached pins are dashed; pins on the
 *   same spot fan out; a new agent comment pulses);
 * - the draft composer and the open thread, in Storybook's `Popover` chrome;
 * - the comment list (`CommentList`).
 *
 * All stories share this page, so a story's global CSS reaches these elements. Every element here
 * sets the properties it depends on (font, colour, box model, line height, text transform) on its
 * own class, which beats tag and universal selectors from stories; the layer itself starts from
 * `all: initial`.
 */
import React, { useEffect, useRef, useState } from 'react';

import { Badge, Button, Form, Popover, ToggleButton } from 'storybook/internal/components';
import { CheckIcon, CloseIcon, TrashIcon, UserIcon } from '@storybook/icons';
import { keyframes, styled } from 'storybook/theming/emotion';

import { describeAnchor, timeAgo } from '../../board/comment-pins';
import type { Size } from '../../board/viewport';
import type { Comment } from '../../canvas-file';
import { CommentList } from './CommentList';
import { AuthorIcon, authorLabel, box, hardText, storyCssShield } from './comment-ui';
import type { CommentLayerState, ShownPin } from './use-comments';

/** Pins and cards sit above the mode layer (2) and below the toolbar and notice (3, later in the DOM). */
export const COMMENT_LAYER_Z = 3;
/** Storybook's minimum touch target (`code/core/src/highlight/constants.ts`, MIN_TOUCH_AREA_SIZE). */
export const PIN_SIZE = 28;
/** Pins on one spot fan out to the right, each still showing most of itself (and clickable). */
const STACK_STEP = 22;
const CARD_WIDTH = 320;

const Layer = styled.div({
  all: 'initial',
  position: 'absolute',
  inset: 0,
  zIndex: COMMENT_LAYER_Z,
  pointerEvents: 'none',
  overflow: 'hidden',
  ...storyCssShield,
});

const Highlight = styled.div(({ theme }) => ({
  ...box,
  position: 'absolute',
  boxSizing: 'border-box',
  pointerEvents: 'none',
  outline: `2px solid ${theme.color.secondary}`,
  outlineOffset: 0,
  background: `${theme.color.secondary}14`,
  borderRadius: 2,
  '&[data-kind="frame"]': { outlineStyle: 'dashed', background: 'transparent' },
}));

const HighlightLabel = styled.span(({ theme }) => ({
  ...hardText(theme),
  position: 'absolute',
  left: -2,
  bottom: '100%',
  marginBottom: 4,
  padding: '1px 6px',
  borderRadius: 3,
  whiteSpace: 'nowrap',
  maxWidth: 320,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: theme.typography.size.s1,
  lineHeight: '16px',
  color: theme.color.lightest,
  background: theme.color.secondary,
}));

const pulse = keyframes({
  '0%': { boxShadow: '0 0 0 0 rgba(111, 44, 172, 0.55)' },
  '70%': { boxShadow: '0 0 0 12px rgba(111, 44, 172, 0)' },
  '100%': { boxShadow: '0 0 0 0 rgba(111, 44, 172, 0)' },
});

const Pin = styled.button(({ theme }) => ({
  // Doubled class: beats a story's attribute rules such as \`[aria-label] { min-width }\`.
  '&&': { width: PIN_SIZE, minWidth: PIN_SIZE, maxWidth: PIN_SIZE, height: PIN_SIZE, minHeight: PIN_SIZE },
  all: 'unset',
  ...hardText(theme),
  position: 'absolute',
  boxSizing: 'border-box',
  width: PIN_SIZE,
  height: PIN_SIZE,
  padding: 0,
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // A speech-bubble pin whose bottom-left corner is the anchored point.
  borderRadius: '50% 50% 50% 2px',
  border: `2px solid ${theme.background.content}`,
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.25)',
  cursor: 'pointer',
  pointerEvents: 'auto',
  color: theme.color.lightest,
  background: theme.color.secondary,
  '&[data-author="agent"]': { background: theme.color.purple },
  '&[data-status="resolved"]': { background: theme.color.mediumdark, opacity: 0.75 },
  '&[data-state="detached"]': { borderStyle: 'dashed', borderColor: theme.color.warning },
  '&[data-open]': { outline: `2px solid ${theme.color.secondary}`, outlineOffset: 2 },
  '&[data-fresh]': { animation: `${pulse} 1.2s ease-out 3` },
  '&:focus-visible': { outline: `2px solid ${theme.color.secondary}`, outlineOffset: 2 },
  '& svg': { width: 14, height: 14, display: 'block' },
}));

const ReplyCount = styled.span(({ theme }) => ({
  ...hardText(theme),
  position: 'absolute',
  top: -6,
  right: -6,
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: 8,
  fontSize: 10,
  lineHeight: '16px',
  fontWeight: 700,
  textAlign: 'center',
  color: theme.color.defaultText,
  background: theme.background.content,
  boxShadow: `0 0 0 1px ${theme.appBorderColor}`,
}));

const CardPosition = styled.div({
  ...box,
  position: 'absolute',
  width: CARD_WIDTH,
  pointerEvents: 'auto',
});

const Card = styled.div(({ theme }) => ({
  ...box,
  ...hardText(theme),
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  maxHeight: 420,
  // Popover's chrome is see-through in Storybook 11; a thread must hide what is under it.
  background: theme.background.content,
  borderRadius: theme.appBorderRadius,
  overflowY: 'auto',
  '& textarea': { ...hardText(theme), width: '100%' },
}));

const Row = styled.div({ ...box, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 });

const Author = styled.span(({ theme }) => ({
  ...hardText(theme),
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontWeight: 700,
  '&[data-author="agent"]': { color: theme.base === 'dark' ? '#c9a2f2' : theme.color.purple },
  '& svg': { width: 12, height: 12 },
}));

const Muted = styled.span(({ theme }) => ({
  ...hardText(theme),
  fontSize: theme.typography.size.s1,
  color: theme.textMutedColor,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}));

const Body = styled.p(({ theme }) => ({
  ...hardText(theme),
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
}));

const Selector = styled.code(({ theme }) => ({
  ...hardText(theme),
  fontFamily: theme.typography.fonts.mono,
  fontSize: theme.typography.size.s1 - 1,
  color: theme.textMutedColor,
  overflowWrap: 'anywhere',
}));

const Reply = styled.div(({ theme }) => ({
  ...box,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  paddingLeft: 10,
  borderLeft: `2px solid ${theme.appBorderColor}`,
}));

const Actions = styled.div({ ...box, display: 'flex', justifyContent: 'flex-end', gap: 6 });
const Spacer = styled.span({ flex: 1 });

/** Where a card goes next to a screen point: to its right, or to its left near the right edge. */
function cardPosition(point: { x: number; y: number }, board: Size): React.CSSProperties {
  const right = point.x + PIN_SIZE + 8;
  const left = right + CARD_WIDTH > board.width - 8 ? Math.max(8, point.x - CARD_WIDTH - 8) : right;
  const top = Math.min(Math.max(8, point.y - PIN_SIZE), Math.max(8, board.height - 200));
  return { left, top };
}

function submitOnModEnter(event: React.KeyboardEvent, submit: () => void) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit();
  }
}

/** A text box with a primary button: the new-comment composer and the reply box. */
function Composer({
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
  disabled,
  name,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  name: string;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const empty = body.trim().length === 0;
  const submit = () => {
    if (empty || busy || disabled) return;
    setBusy(true);
    void onSubmit(body.trim()).then((ok) => {
      setBusy(false);
      if (ok) setBody('');
    });
  };
  return (
    <>
      <Form.Textarea
        aria-label={placeholder}
        placeholder={placeholder}
        value={body}
        minRows={2}
        maxRows={8}
        autoFocus={autoFocus}
        data-colab-composer={name}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          submitOnModEnter(event, submit);
          if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Actions>
        {onCancel && (
          <Button variant="ghost" size="small" ariaLabel={false} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="solid"
          size="small"
          ariaLabel={false}
          disabled={empty || busy || disabled}
          data-colab-submit={name}
          onClick={submit}
        >
          {submitLabel}
        </Button>
      </Actions>
    </>
  );
}

function ThreadCard({ pin, comment, state }: { pin?: ShownPin; comment: Comment; state: CommentLayerState }) {
  const resolved = comment.status === 'resolved';
  const anchor = comment.anchor;
  const detached = pin?.placement.state === 'detached';
  const orphan = !pin || pin.placement.state === 'orphan';
  return (
    <Card data-colab-thread={comment.id}>
      <Row>
        <Author data-author={comment.author}>
          <AuthorIcon author={comment.author} />
          {authorLabel(comment.author)}
        </Author>
        <Muted title={comment.createdAt}>{timeAgo(comment.createdAt)}</Muted>
        <Spacer />
        <ToggleButton
          variant="ghost"
          padding="small"
          pressed={resolved}
          ariaLabel={resolved ? 'Reopen comment' : 'Resolve comment'}
          data-colab-resolve=""
          onClick={() => void state.setResolved(comment.id, !resolved)}
        >
          <CheckIcon />
        </ToggleButton>
        <Button
          variant="ghost"
          padding="small"
          ariaLabel="Delete comment"
          data-colab-delete=""
          onClick={() => state.remove(comment.id)}
        >
          <TrashIcon />
        </Button>
        <Button variant="ghost" padding="small" ariaLabel="Close comment" onClick={() => state.setOpenId(null)}>
          <CloseIcon />
        </Button>
      </Row>
      <Row>
        <Muted>{describeAnchor(anchor, state.storyName)}</Muted>
        {resolved && <Badge status="positive">Resolved</Badge>}
        {detached && <Badge status="warning">Detached</Badge>}
        {orphan && anchor.type !== 'position' && <Badge status="neutral">Story not on canvas</Badge>}
      </Row>
      {anchor.type === 'element' && (
        <Selector title="Selector, relative to the story root">{anchor.target.selector}</Selector>
      )}
      <Body>{comment.body}</Body>
      {comment.replies.map((reply) => (
        <Reply key={reply.id} data-colab-reply={reply.id}>
          <Row>
            <Author data-author={reply.author}>
              <AuthorIcon author={reply.author} />
              {authorLabel(reply.author)}
            </Author>
            <Muted title={reply.createdAt}>{timeAgo(reply.createdAt)}</Muted>
          </Row>
          <Body>{reply.body}</Body>
        </Reply>
      ))}
      <Composer
        key={comment.id}
        name="reply"
        placeholder="Reply…"
        submitLabel="Reply"
        onSubmit={(body) => state.reply(comment.id, body)}
      />
    </Card>
  );
}

/**
 * Pins at a frame's very corner (a detached element, a story not rendered yet, a frame comment with
 * no offset) hang inside the frame instead of above it, so they do not cover the frame's title.
 */
function insideFrame(pin: ShownPin): boolean {
  const { placement } = pin;
  if (placement.state === 'detached' || placement.state === 'pending') return true;
  const { anchor } = pin.comment;
  return anchor.type === 'frame' && anchor.x === undefined;
}

function pinLabel(comment: Comment, state: CommentLayerState): string {
  const status = comment.status === 'resolved' ? ' (resolved)' : '';
  const replies = comment.replies.length
    ? `, ${comment.replies.length} repl${comment.replies.length === 1 ? 'y' : 'ies'}`
    : '';
  return `Comment by ${authorLabel(comment.author).toLowerCase()}${status} on ${describeAnchor(comment.anchor, state.storyName)}${replies}`;
}

export interface CommentLayerProps {
  state: CommentLayerState;
  board: Size;
}

export function CommentLayer({ state, board }: CommentLayerProps) {
  const { pins, hover, draft, draftScreen, openId } = state;
  const open = openId ? (state.comments.find((c) => c.id === openId) ?? null) : null;
  const openPin = open ? pins.find((p) => p.comment.id === open.id) : undefined;
  const pinRefs = useRef(new Map<string, HTMLButtonElement>());

  // Closing a thread returns focus to its pin.
  const lastOpen = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastOpen.current;
    lastOpen.current = openId;
    if (previous && !openId) pinRefs.current.get(previous)?.focus({ preventScroll: true });
  }, [openId]);

  const close = () => state.setOpenId(null);

  return (
    <Layer data-colab-comments="">
      {hover && (
        <Highlight
          data-colab-hover={hover.kind}
          data-kind={hover.kind}
          style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }}
        >
          <HighlightLabel>{hover.label}</HighlightLabel>
        </Highlight>
      )}

      {state.listOpen && <CommentList state={state} />}

      {pins.map((pin) => {
        if (!pin.screen) return null;
        const { comment } = pin;
        return (
          <Pin
            key={comment.id}
            ref={(element) => {
              if (element) pinRefs.current.set(comment.id, element);
              else pinRefs.current.delete(comment.id);
            }}
            type="button"
            aria-label={pinLabel(comment, state)}
            aria-expanded={openId === comment.id}
            title={pin.placement.state === 'detached' ? 'The element is gone: shown on its story' : undefined}
            data-colab-pin={comment.id}
            data-colab-own=""
            data-author={comment.author}
            data-status={comment.status}
            data-state={pin.placement.state}
            data-open={openId === comment.id ? '' : undefined}
            data-fresh={pin.fresh ? '' : undefined}
            style={{
              left: pin.screen.x + pin.stack * STACK_STEP,
              top: pin.screen.y - (insideFrame(pin) ? 0 : PIN_SIZE),
            }}
            // A press on a pin is not a press on the board (no new comment, no pan, no select).
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => state.setOpenId(openId === comment.id ? null : comment.id)}
          >
            <AuthorIcon author={comment.author} />
            {comment.replies.length > 0 && <ReplyCount aria-hidden>{comment.replies.length}</ReplyCount>}
          </Pin>
        );
      })}

      {draft && draftScreen && (
        <>
          <Pin
            as="div"
            aria-hidden
            data-colab-draft-pin=""
            data-author="user"
            style={{ left: draftScreen.x, top: draftScreen.y - PIN_SIZE, cursor: 'default' }}
          >
            <UserIcon aria-hidden />
          </Pin>
          <CardPosition style={cardPosition(draftScreen, board)} onPointerDown={(event) => event.stopPropagation()}>
            <Popover hasChrome padding={0} scrollable={false}>
              <Card data-colab-draft="">
                <Muted>{draft.label}</Muted>
                {draft.anchor.type === 'element' && <Selector>{draft.anchor.target.selector}</Selector>}
                <Composer
                  name="comment"
                  placeholder="Add a comment…"
                  submitLabel="Comment"
                  autoFocus
                  disabled={draft.loading}
                  onSubmit={state.submitDraft}
                  onCancel={state.cancelDraft}
                />
              </Card>
            </Popover>
          </CardPosition>
        </>
      )}

      {open && (
        <CardPosition
          style={
            openPin?.screen
              ? cardPosition({ x: openPin.screen.x + openPin.stack * STACK_STEP, y: openPin.screen.y }, board)
              : { right: state.listOpen ? 332 : 12, top: 12 }
          }
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault();
              close();
            }
          }}
        >
          <Popover hasChrome padding={0} scrollable={false}>
            <ThreadCard pin={openPin} comment={open} state={state} />
          </Popover>
        </CardPosition>
      )}
    </Layer>
  );
}
