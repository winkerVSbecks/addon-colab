/**
 * The list of every comment on the canvas, docked on the right of the board. Clicking one brings its
 * pin into view and opens its thread; comments whose story is no longer on the canvas are listed
 * too and open their thread next to the list.
 *
 * Why a list on the board and not an addon panel: task 5a hides Storybook's addon panel on canvas
 * pages so the board gets the whole preview, and the list drives board state that lives in the
 * preview (the open thread, centring a pin). A manager panel would need its own copy of the canvas
 * and a new channel event to focus a pin. Built from Storybook's `ScrollArea`, `Button`,
 * `ToggleButton`, `Badge` and `EmptyTabContent`, like addon panels (e.g. the a11y panel's result
 * list, `code/addons/a11y/src/components/Report/Report.tsx`).
 */
import React from 'react';

import { Badge, Button, EmptyTabContent, ScrollArea, ToggleButton } from 'storybook/internal/components';
import { CheckIcon, CloseIcon } from '@storybook/icons';
import { styled } from 'storybook/theming/emotion';

import { describeAnchor, sortComments, timeAgo } from '../../board/comment-pins';
import { AuthorIcon, authorLabel, hardText } from './comment-ui';
import type { CommentLayerState } from './use-comments';

export const LIST_WIDTH = 320;

const Panel = styled.aside(({ theme }) => ({
  ...hardText(theme),
  position: 'absolute',
  top: 12,
  right: 12,
  bottom: 64,
  width: LIST_WIDTH,
  display: 'flex',
  flexDirection: 'column',
  pointerEvents: 'auto',
  borderRadius: theme.appBorderRadius,
  border: `1px solid ${theme.appBorderColor}`,
  background: theme.background.content,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
  overflow: 'hidden',
}));

const Header = styled.div(({ theme }) => ({
  ...hardText(theme),
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 4px 4px 12px',
  minHeight: 40,
  borderBottom: `1px solid ${theme.appBorderColor}`,
  background: theme.background.bar,
}));

const Title = styled.h2(({ theme }) => ({
  ...hardText(theme),
  flex: 1,
  fontWeight: 700,
  fontSize: theme.typography.size.s2,
}));

const Items = styled.ul({ listStyle: 'none', margin: 0, padding: 0 });

const Item = styled.button(({ theme }) => ({
  all: 'unset',
  ...hardText(theme),
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  width: '100%',
  padding: '10px 12px',
  cursor: 'pointer',
  borderBottom: `1px solid ${theme.appBorderColor}`,
  '&:hover': { background: theme.background.hoverable },
  '&:focus-visible': { outline: `2px solid ${theme.color.secondary}`, outlineOffset: -2 },
  '&[aria-current="true"]': { boxShadow: `inset 3px 0 0 ${theme.color.secondary}` },
  '&[data-status="resolved"]': { opacity: 0.7 },
}));

const Line = styled.span({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 });

const Who = styled.span(({ theme }) => ({
  ...hardText(theme),
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontWeight: 700,
  '&[data-author="agent"]': { color: theme.base === 'dark' ? '#c9a2f2' : theme.color.purple },
  '& svg': { width: 12, height: 12 },
}));

const Small = styled.span(({ theme }) => ({
  ...hardText(theme),
  fontSize: theme.typography.size.s1,
  color: theme.textMutedColor,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
}));

const Excerpt = styled.span(({ theme }) => ({
  ...hardText(theme),
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
}));

export function CommentList({ state }: { state: CommentLayerState }) {
  const all = sortComments(state.comments);
  const shown = all.filter((c) => state.showResolved || c.status === 'open');
  const resolvedCount = all.length - all.filter((c) => c.status === 'open').length;
  const placements = new Map(state.pins.map((pin) => [pin.comment.id, pin.placement.state]));

  return (
    <Panel aria-label="Comments" data-colab-comment-list="" onPointerDown={(event) => event.stopPropagation()}>
      <Header>
        <Title>Comments</Title>
        <ToggleButton
          variant="ghost"
          size="small"
          pressed={state.showResolved}
          ariaLabel={false}
          data-colab-show-resolved=""
          onClick={() => state.setShowResolved(!state.showResolved)}
        >
          <CheckIcon />
          {`Resolved (${resolvedCount})`}
        </ToggleButton>
        <Button variant="ghost" padding="small" ariaLabel="Close comments" onClick={() => state.setListOpen(false)}>
          <CloseIcon />
        </Button>
      </Header>
      {shown.length === 0 ? (
        <EmptyTabContent
          title={all.length === 0 ? 'No comments yet' : 'No open comments'}
          description={
            all.length === 0
              ? 'Choose Comment in the toolbar (C), then click an element in a story or anywhere on the canvas.'
              : 'Show resolved comments to see the rest.'
          }
        />
      ) : (
        <ScrollArea vertical>
          <Items>
            {shown.map((comment) => {
              const placement =
                comment.status === 'resolved' && !state.showResolved ? undefined : placements.get(comment.id);
              return (
                <li key={comment.id}>
                  <Item
                    type="button"
                    data-colab-list-item={comment.id}
                    data-status={comment.status}
                    aria-current={state.openId === comment.id ? 'true' : undefined}
                    onClick={() => state.focus(comment.id)}
                  >
                    <Line>
                      <Who data-author={comment.author}>
                        <AuthorIcon author={comment.author} />
                        {authorLabel(comment.author)}
                      </Who>
                      <Small>{timeAgo(comment.createdAt)}</Small>
                      {comment.replies.length > 0 && (
                        <Small>
                          · {comment.replies.length} repl{comment.replies.length === 1 ? 'y' : 'ies'}
                        </Small>
                      )}
                    </Line>
                    <Excerpt>{comment.body}</Excerpt>
                    <Line>
                      <Small>{describeAnchor(comment.anchor, state.storyName)}</Small>
                      {comment.status === 'resolved' && <Badge status="positive">Resolved</Badge>}
                      {placement === 'detached' && <Badge status="warning">Detached</Badge>}
                      {placement === 'orphan' && <Badge status="neutral">Not on canvas</Badge>}
                    </Line>
                  </Item>
                </li>
              );
            })}
          </Items>
        </ScrollArea>
      )}
    </Panel>
  );
}
