import { LIMITS } from './limits';
import type { Op } from './protocol';
import { findTemplate } from './templates';
import {
  type Actor,
  type Board,
  type Card,
  type Comment,
  DEFAULT_SETTINGS,
  type Settings,
} from './types';

/**
 * The one place board state changes. Pure: returns a new board or throws an
 * `OpError`. The server runs it to decide and persist; clients run it to
 * apply their own ops optimistically and everyone else's as they arrive.
 * Permission rules live here too, so the UI can never do what the server
 * would refuse.
 */

export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}

function fail(message: string): never {
  throw new OpError(message);
}

export interface CreateBoardInput {
  code: string;
  title: string;
  templateId: string;
  ownerId: string;
  ownerName: string;
  createdAt: number;
  expiresAt: number;
  settings?: Partial<Settings>;
}

export function createBoard(input: CreateBoardInput): Board {
  const template = findTemplate(input.templateId);
  return {
    code: input.code,
    title: input.title.trim().slice(0, LIMITS.titleMax) || template.name,
    template: template.id,
    phase: 'write',
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    ownerId: input.ownerId,
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    timer: null,
    columns: template.columns.map((title, i) => ({
      id: `col-${i + 1}`,
      title,
      position: i,
    })),
    cards: [],
    votes: [],
    reactions: [],
    comments: [],
    actionItems: [],
    participants: [{ id: input.ownerId, name: input.ownerName, online: false }],
  };
}

/**
 * Fill in fields added after a board was stored, so a board created before
 * a deploy keeps working after it. Run on every document read from storage.
 */
export function upgradeBoard(board: Board): Board {
  return {
    ...board,
    reactions: board.reactions ?? [],
    comments: board.comments ?? [],
  };
}

/* ---------- helpers ---------- */

function canFacilitate(board: Board, actor: Actor): boolean {
  return !board.settings.facilitatorOnly || actor.isOwner;
}

function requireFacilitator(board: Board, actor: Actor) {
  if (!canFacilitate(board, actor)) {
    fail('Only the board owner can do that on this board');
  }
}

function findCard(board: Board, id: string): Card {
  return board.cards.find((c) => c.id === id) ?? fail('That card is gone');
}

/** Edit and delete: the author or the owner. */
function canEditCard(card: Card, actor: Actor): boolean {
  return card.authorId === actor.id || actor.isOwner;
}

/**
 * During Write, with blurring on, only the author can read a card, so only
 * the author can react to it or comment on it. The UI hides both too.
 */
export function isCardHidden(board: Board, card: Card, viewerId: string) {
  return (
    board.phase === 'write' &&
    board.settings.blurDuringWrite &&
    card.authorId !== viewerId
  );
}

function findComment(board: Board, id: string): Comment {
  return (
    board.comments.find((c) => c.id === id) ?? fail('That comment is gone')
  );
}

/** Move, group, ungroup: anyone, unless the owner locked facilitation. */
function canArrangeCard(board: Board, card: Card, actor: Actor): boolean {
  return canEditCard(card, actor) || canFacilitate(board, actor);
}

export function votesUsed(board: Board, participantId: string): number {
  let used = 0;
  for (const v of board.votes) {
    if (v.participantId === participantId) {
      used += v.count;
    }
  }
  return used;
}

export function votesFor(board: Board, cardId: string): number {
  let total = 0;
  for (const v of board.votes) {
    if (v.cardId === cardId) {
      total += v.count;
    }
  }
  return total;
}

/** Cards in a column in display order: a group's members sit together. */
export function cardsInColumn(board: Board, columnId: string): Card[] {
  return board.cards
    .filter((c) => c.columnId === columnId)
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

/** Next free position at the end of a column. */
function endPosition(board: Board, columnId: string): number {
  let max = -1;
  for (const c of board.cards) {
    if (c.columnId === columnId && c.position > max) {
      max = c.position;
    }
  }
  return max + 1;
}

/** Ensure a participant record exists (names can change). */
function withParticipant(board: Board, actor: Actor): Board {
  const existing = board.participants.find((p) => p.id === actor.id);
  if (existing) {
    if (existing.name === actor.name) {
      return board;
    }
    return {
      ...board,
      participants: board.participants.map((p) =>
        p.id === actor.id ? { ...p, name: actor.name } : p,
      ),
    };
  }
  if (board.participants.length >= LIMITS.participantsMax) {
    fail('This board is full');
  }
  return {
    ...board,
    participants: [
      ...board.participants,
      { id: actor.id, name: actor.name, online: true },
    ],
  };
}

/* ---------- the reducer ---------- */

/** `now` is the server's clock on the echo, so every client agrees on timestamps. */
export function reduce(
  input: Board,
  op: Op,
  actor: Actor,
  now: number = Date.now(),
): Board {
  const board = withParticipant(input, actor);

  switch (op.type) {
    case 'addCard': {
      if (board.cards.some((c) => c.id === op.id)) {
        return board; // duplicate delivery
      }
      if (board.cards.length >= LIMITS.cardsMax) {
        fail('This board has reached its card limit');
      }
      if (!board.columns.some((c) => c.id === op.columnId)) {
        fail('That column is gone');
      }
      if (op.anonymous && !board.settings.anonymousAllowed) {
        fail('Anonymous cards are off for this board');
      }
      const card: Card = {
        id: op.id,
        columnId: op.columnId,
        groupId: null,
        authorId: actor.id,
        authorName: op.anonymous ? '' : actor.name,
        anonymous: op.anonymous,
        text: op.text,
        position: endPosition(board, op.columnId),
        createdAt: now,
      };
      return { ...board, cards: [...board.cards, card] };
    }

    case 'editCard': {
      const card = findCard(board, op.id);
      if (card.authorId !== actor.id && !actor.isOwner) {
        fail('You can only edit your own cards');
      }
      return {
        ...board,
        cards: board.cards.map((c) =>
          c.id === op.id ? { ...c, text: op.text } : c,
        ),
      };
    }

    case 'deleteCard': {
      const card = board.cards.find((c) => c.id === op.id);
      if (!card) {
        return board;
      }
      if (!canEditCard(card, actor)) {
        fail('You can only delete your own cards');
      }
      return {
        ...board,
        cards: board.cards.filter((c) => c.id !== op.id),
        votes: board.votes.filter((v) => v.cardId !== op.id),
        reactions: board.reactions.filter((r) => r.cardId !== op.id),
        comments: board.comments.filter((c) => c.cardId !== op.id),
      };
    }

    case 'moveCard': {
      const card = findCard(board, op.id);
      if (!board.columns.some((c) => c.id === op.columnId)) {
        fail('That column is gone');
      }
      if (!canArrangeCard(board, card, actor)) {
        fail('Only the board owner can move cards on this board');
      }
      // Moving a whole group moves every member; moving a member alone
      // leaves the group.
      const groupMembers =
        card.groupId !== null
          ? board.cards.filter((c) => c.groupId === card.groupId)
          : [card];
      const moving = new Set(groupMembers.map((c) => c.id));
      const others = cardsInColumn(board, op.columnId).filter(
        (c) => !moving.has(c.id),
      );
      // Rebuild positions for the target column with the moved cards
      // inserted at `position` (counted in cards, group members adjacent).
      const insertAt = Math.min(op.position ?? others.length, others.length);
      const ordered = [
        ...others.slice(0, insertAt),
        ...groupMembers,
        ...others.slice(insertAt),
      ];
      const positions = new Map(ordered.map((c, i) => [c.id, i]));
      return {
        ...board,
        cards: board.cards.map((c) => {
          if (moving.has(c.id)) {
            return {
              ...c,
              columnId: op.columnId,
              position: positions.get(c.id) ?? 0,
            };
          }
          const p = positions.get(c.id);
          return p === undefined ? c : { ...c, position: p };
        }),
      };
    }

    case 'groupCards': {
      const card = findCard(board, op.id);
      const target = findCard(board, op.targetId);
      if (card.id === target.id) {
        return board;
      }
      if (!canArrangeCard(board, card, actor)) {
        fail('Only the board owner can group cards on this board');
      }
      const groupId = target.groupId ?? op.groupId;
      const members =
        card.groupId !== null
          ? new Set(
              board.cards
                .filter((c) => c.groupId === card.groupId)
                .map((c) => c.id),
            )
          : new Set([card.id]);
      return {
        ...board,
        cards: board.cards.map((c) => {
          if (c.id === target.id) {
            return { ...c, groupId };
          }
          if (members.has(c.id)) {
            return {
              ...c,
              groupId,
              columnId: target.columnId,
              position: target.position,
            };
          }
          return c;
        }),
      };
    }

    case 'ungroupCard': {
      const card = findCard(board, op.id);
      if (card.groupId === null) {
        return board;
      }
      if (!canArrangeCard(board, card, actor)) {
        fail('Only the board owner can ungroup cards on this board');
      }
      const remaining = board.cards.filter(
        (c) => c.groupId === card.groupId && c.id !== card.id,
      );
      // A group of one is not a group.
      const dissolve = remaining.length < 2;
      return {
        ...board,
        cards: board.cards.map((c) => {
          if (c.id === card.id) {
            return {
              ...c,
              groupId: null,
              position: endPosition(board, c.columnId),
            };
          }
          if (dissolve && c.groupId === card.groupId) {
            return { ...c, groupId: null };
          }
          return c;
        }),
      };
    }

    case 'vote': {
      if (board.phase === 'write') {
        fail('Voting opens after the Write phase');
      }
      findCard(board, op.cardId);
      if (votesUsed(board, actor.id) >= board.settings.votesPerPerson) {
        fail('You have used all your votes');
      }
      const existing = board.votes.find(
        (v) => v.cardId === op.cardId && v.participantId === actor.id,
      );
      return {
        ...board,
        votes: existing
          ? board.votes.map((v) =>
              v === existing ? { ...v, count: v.count + 1 } : v,
            )
          : [
              ...board.votes,
              { cardId: op.cardId, participantId: actor.id, count: 1 },
            ],
      };
    }

    case 'unvote': {
      const existing = board.votes.find(
        (v) => v.cardId === op.cardId && v.participantId === actor.id,
      );
      if (!existing) {
        return board;
      }
      return {
        ...board,
        votes:
          existing.count > 1
            ? board.votes.map((v) =>
                v === existing ? { ...v, count: v.count - 1 } : v,
              )
            : board.votes.filter((v) => v !== existing),
      };
    }

    case 'toggleReaction': {
      const card = findCard(board, op.cardId);
      if (isCardHidden(board, card, actor.id)) {
        fail('Reactions open when the Write phase ends');
      }
      const mine = (r: Board['reactions'][number]) =>
        r.cardId === op.cardId &&
        r.participantId === actor.id &&
        r.emoji === op.emoji;
      if (board.reactions.some(mine)) {
        return {
          ...board,
          reactions: board.reactions.filter((r) => !mine(r)),
        };
      }
      if (board.reactions.length >= LIMITS.reactionsMax) {
        fail('This board has reached its reaction limit');
      }
      return {
        ...board,
        reactions: [
          ...board.reactions,
          { cardId: op.cardId, participantId: actor.id, emoji: op.emoji },
        ],
      };
    }

    case 'addComment': {
      if (board.comments.some((c) => c.id === op.id)) {
        return board; // duplicate delivery
      }
      const card = findCard(board, op.cardId);
      if (isCardHidden(board, card, actor.id)) {
        fail('Comments open when the Write phase ends');
      }
      if (op.anonymous && !board.settings.anonymousAllowed) {
        fail('Anonymous comments are off for this board');
      }
      if (board.comments.length >= LIMITS.commentsMax) {
        fail('This board has reached its comment limit');
      }
      const onCard = board.comments.filter((c) => c.cardId === card.id);
      if (onCard.length >= LIMITS.commentsPerCardMax) {
        fail('This card has reached its comment limit');
      }
      return {
        ...board,
        comments: [
          ...board.comments,
          {
            id: op.id,
            cardId: card.id,
            authorId: actor.id,
            authorName: op.anonymous ? '' : actor.name,
            anonymous: op.anonymous,
            text: op.text,
            createdAt: now,
            editedAt: null,
          },
        ],
      };
    }

    case 'editComment': {
      const comment = findComment(board, op.id);
      if (comment.authorId !== actor.id) {
        fail('You can only edit your own comments');
      }
      return {
        ...board,
        comments: board.comments.map((c) =>
          c.id === op.id ? { ...c, text: op.text, editedAt: now } : c,
        ),
      };
    }

    case 'deleteComment': {
      const comment = board.comments.find((c) => c.id === op.id);
      if (!comment) {
        return board;
      }
      if (comment.authorId !== actor.id && !actor.isOwner) {
        fail('You can only delete your own comments');
      }
      return {
        ...board,
        comments: board.comments.filter((c) => c.id !== op.id),
      };
    }

    case 'setPhase': {
      requireFacilitator(board, actor);
      return { ...board, phase: op.phase };
    }

    case 'setTimer': {
      requireFacilitator(board, actor);
      return {
        ...board,
        timer: { endsAt: op.endsAt, durationMs: op.durationMs },
      };
    }

    case 'clearTimer': {
      requireFacilitator(board, actor);
      return { ...board, timer: null };
    }

    case 'addColumn': {
      requireFacilitator(board, actor);
      if (board.columns.some((c) => c.id === op.id)) {
        return board;
      }
      if (board.columns.length >= LIMITS.columnsMax) {
        fail('This board has reached its column limit');
      }
      return {
        ...board,
        columns: [
          ...board.columns,
          { id: op.id, title: op.title, position: board.columns.length },
        ],
      };
    }

    case 'renameColumn': {
      requireFacilitator(board, actor);
      if (!board.columns.some((c) => c.id === op.id)) {
        fail('That column is gone');
      }
      return {
        ...board,
        columns: board.columns.map((c) =>
          c.id === op.id ? { ...c, title: op.title } : c,
        ),
      };
    }

    case 'deleteColumn': {
      requireFacilitator(board, actor);
      if (board.columns.length <= 1) {
        fail('A board needs at least one column');
      }
      const removed = new Set(
        board.cards.filter((c) => c.columnId === op.id).map((c) => c.id),
      );
      return {
        ...board,
        columns: board.columns
          .filter((c) => c.id !== op.id)
          .map((c, i) => ({ ...c, position: i })),
        cards: board.cards.filter((c) => !removed.has(c.id)),
        votes: board.votes.filter((v) => !removed.has(v.cardId)),
        reactions: board.reactions.filter((r) => !removed.has(r.cardId)),
        comments: board.comments.filter((c) => !removed.has(c.cardId)),
      };
    }

    case 'addActionItem': {
      if (board.actionItems.some((a) => a.id === op.id)) {
        return board;
      }
      if (board.actionItems.length >= LIMITS.actionItemsMax) {
        fail('This board has reached its action item limit');
      }
      return {
        ...board,
        actionItems: [
          ...board.actionItems,
          {
            id: op.id,
            text: op.text,
            owner: op.owner,
            done: false,
            createdAt: now,
          },
        ],
      };
    }

    case 'editActionItem': {
      if (!board.actionItems.some((a) => a.id === op.id)) {
        fail('That action item is gone');
      }
      return {
        ...board,
        actionItems: board.actionItems.map((a) =>
          a.id === op.id ? { ...a, text: op.text, owner: op.owner } : a,
        ),
      };
    }

    case 'toggleActionItem': {
      return {
        ...board,
        actionItems: board.actionItems.map((a) =>
          a.id === op.id ? { ...a, done: !a.done } : a,
        ),
      };
    }

    case 'deleteActionItem': {
      return {
        ...board,
        actionItems: board.actionItems.filter((a) => a.id !== op.id),
      };
    }

    case 'updateSettings': {
      if (!actor.isOwner) {
        fail('Only the board owner can change settings');
      }
      return { ...board, settings: { ...board.settings, ...op.settings } };
    }

    case 'renameBoard': {
      requireFacilitator(board, actor);
      return { ...board, title: op.title };
    }

    case 'setName': {
      // `withParticipant` already synced the actor's name from the socket;
      // this also rewrites the name on their non-anonymous cards and comments.
      return {
        ...board,
        participants: board.participants.map((p) =>
          p.id === actor.id ? { ...p, name: op.name } : p,
        ),
        cards: board.cards.map((c) =>
          c.authorId === actor.id && !c.anonymous
            ? { ...c, authorName: op.name }
            : c,
        ),
        comments: board.comments.map((c) =>
          c.authorId === actor.id && !c.anonymous
            ? { ...c, authorName: op.name }
            : c,
        ),
      };
    }
  }
}
