import { LIMITS } from './limits';
import type { BoardOp } from './protocol';
import { findTemplate } from './templates';
import {
  type ActionItem,
  type Actor,
  type Board,
  type Card,
  type Comment,
  DEFAULT_SETTINGS,
  type Settings,
  type Viewer,
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
    columns: template.columns.map((c, i) => ({
      id: `col-${i + 1}`,
      title: c.title,
      prompt: c.prompt,
      position: i,
    })),
    cards: [],
    votes: [],
    reactions: [],
    comments: [],
    actionItems: [],
    participants: [{ id: input.ownerId, name: input.ownerName, online: false }],
    done: [],
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
    actionItems: board.actionItems.map((a) => ({
      ...a,
      cardId: a.cardId ?? null,
    })),
    columns: board.columns.map((c) => ({ ...c, prompt: c.prompt ?? '' })),
    done: board.done ?? [],
  };
}

/* ---------- helpers ---------- */

/**
 * The card an action item may link to: it has to exist and be readable by
 * the actor (not blurred for them in Write).
 */
function linkableCardId(
  board: Board,
  cardId: string | null | undefined,
  actor: Actor,
): string | null {
  if (cardId == null) {
    return null;
  }
  const card = findCard(board, cardId);
  if (isCardHidden(board, card, actor)) {
    fail('You cannot link to a card you cannot read yet');
  }
  if (isCardSealed(board, card)) {
    fail('Anonymous cards can be linked when the Write phase ends');
  }
  return card.id;
}

/** Action items keep living after their card goes; only the link drops. */
function unlinkActionItems(
  board: Board,
  removed: ReadonlySet<string>,
): ActionItem[] {
  return board.actionItems.map((a) =>
    a.cardId !== null && removed.has(a.cardId) ? { ...a, cardId: null } : a,
  );
}

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

/**
 * Did this viewer write the card? On the server the document carries the
 * real author id. On a client, anonymous cards arrive with an empty author
 * id and the viewer's own are listed in `anonymousCardIds` instead. An empty
 * id never matches anything, so a redacted actor owns nothing by accident.
 */
export function isCardAuthor(card: Card, viewer: Viewer): boolean {
  if (viewer.id !== '' && card.authorId === viewer.id) {
    return true;
  }
  return (
    card.anonymous && (viewer.anonymousCardIds?.includes(card.id) ?? false)
  );
}

/** Same as `isCardAuthor`, for comments. */
export function isCommentAuthor(comment: Comment, viewer: Viewer): boolean {
  if (viewer.id !== '' && comment.authorId === viewer.id) {
    return true;
  }
  return (
    comment.anonymous &&
    (viewer.anonymousCommentIds?.includes(comment.id) ?? false)
  );
}

/** Delete: the author or the owner. Editing the text is author-only. */
function canDeleteCard(card: Card, actor: Actor): boolean {
  return isCardAuthor(card, actor) || actor.isOwner;
}

/**
 * During Write, with blurring on, only the author can read a card, so only
 * the author can react to it or comment on it. The UI hides both too.
 */
export function isCardHidden(board: Board, card: Card, viewer: Viewer) {
  return (
    board.phase === 'write' &&
    board.settings.blurDuringWrite &&
    !isCardAuthor(card, viewer)
  );
}

/**
 * An anonymous card still blurred for everyone else. Only its author can
 * read it, so a reaction, comment or action item link on it could only come
 * from them and would name them. Nobody does those until Write ends.
 */
export function isCardSealed(board: Board, card: Card): boolean {
  return (
    board.phase === 'write' && board.settings.blurDuringWrite && card.anonymous
  );
}

function findComment(board: Board, id: string): Comment {
  return (
    board.comments.find((c) => c.id === id) ?? fail('That comment is gone')
  );
}

/** Move, group, ungroup: anyone, unless the owner locked facilitation. */
function canArrangeCard(board: Board, card: Card, actor: Actor): boolean {
  return canDeleteCard(card, actor) || canFacilitate(board, actor);
}

/**
 * The board as it may leave the server: anonymous cards and comments lose
 * their author id. Everything else a client needs to apply ops and render
 * stays. Run on every snapshot; echoes carry no author ids to begin with.
 */
export function redactAnonymous(board: Board): Board {
  return {
    ...board,
    cards: board.cards.map((c) => (c.anonymous ? { ...c, authorId: '' } : c)),
    comments: board.comments.map((c) =>
      c.anonymous ? { ...c, authorId: '' } : c,
    ),
  };
}

/** The anonymous cards and comments one participant wrote, for their `you`. */
export function anonymousIdsFor(
  board: Board,
  participantId: string,
): { anonymousCardIds: string[]; anonymousCommentIds: string[] } {
  return {
    anonymousCardIds: board.cards
      .filter((c) => c.anonymous && c.authorId === participantId)
      .map((c) => c.id),
    anonymousCommentIds: board.comments
      .filter((c) => c.anonymous && c.authorId === participantId)
      .map((c) => c.id),
  };
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

/** Votes a participant can still spend. Says nothing about where they went. */
export function votesLeft(board: Board, participantId: string): number {
  return Math.max(
    0,
    board.settings.votesPerPerson - votesUsed(board, participantId),
  );
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
  if (actor.id === '') {
    return board; // a redacted echo: the author is already seated
  }
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
  op: BoardOp,
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
      if (!isCardAuthor(card, actor)) {
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
      if (!canDeleteCard(card, actor)) {
        fail('You can only delete your own cards');
      }
      return {
        ...board,
        cards: board.cards.filter((c) => c.id !== op.id),
        votes: board.votes.filter((v) => v.cardId !== op.id),
        reactions: board.reactions.filter((r) => r.cardId !== op.id),
        comments: board.comments.filter((c) => c.cardId !== op.id),
        actionItems: unlinkActionItems(board, new Set([op.id])),
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
      if (isCardHidden(board, card, actor)) {
        fail('Reactions open when the Write phase ends');
      }
      if (isCardSealed(board, card)) {
        fail('Reactions on anonymous cards open when the Write phase ends');
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
      if (isCardHidden(board, card, actor)) {
        fail('Comments open when the Write phase ends');
      }
      if (isCardSealed(board, card)) {
        fail('Comments on anonymous cards open when the Write phase ends');
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
      if (!isCommentAuthor(comment, actor)) {
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
      if (!isCommentAuthor(comment, actor) && !actor.isOwner) {
        fail('You can only delete your own comments');
      }
      return {
        ...board,
        comments: board.comments.filter((c) => c.id !== op.id),
      };
    }

    case 'setPhase': {
      requireFacilitator(board, actor);
      if (op.phase === board.phase) {
        return board;
      }
      // "Done" means done with this phase; a new phase starts everyone over.
      return { ...board, phase: op.phase, done: [] };
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
          {
            id: op.id,
            title: op.title,
            prompt: '',
            position: board.columns.length,
          },
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

    case 'setColumnPrompt': {
      requireFacilitator(board, actor);
      if (!board.columns.some((c) => c.id === op.id)) {
        fail('That column is gone');
      }
      // One line: it renders under the title and as one line of the export.
      const prompt = op.prompt.replace(/\s+/g, ' ');
      return {
        ...board,
        columns: board.columns.map((c) =>
          c.id === op.id ? { ...c, prompt } : c,
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
        actionItems: unlinkActionItems(board, removed),
      };
    }

    case 'addActionItem': {
      if (board.actionItems.some((a) => a.id === op.id)) {
        return board;
      }
      if (board.actionItems.length >= LIMITS.actionItemsMax) {
        fail('This board has reached its action item limit');
      }
      const cardId = linkableCardId(board, op.cardId, actor);
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
            cardId,
          },
        ],
      };
    }

    case 'editActionItem': {
      if (!board.actionItems.some((a) => a.id === op.id)) {
        fail('That action item is gone');
      }
      // Leaving `cardId` out keeps the current link; `null` removes it.
      const cardId =
        op.cardId === undefined
          ? undefined
          : linkableCardId(board, op.cardId, actor);
      return {
        ...board,
        actionItems: board.actionItems.map((a) =>
          a.id === op.id
            ? {
                ...a,
                text: op.text,
                owner: op.owner,
                ...(cardId === undefined ? {} : { cardId }),
              }
            : a,
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

    case 'setOwner': {
      // Only the board object emits this, as the current owner, after a
      // handoff code is redeemed (clients cannot send it at all).
      if (!actor.isOwner) {
        fail('Only the board owner can hand the board off');
      }
      if (!board.participants.some((p) => p.id === op.participantId)) {
        fail('The new owner has to be on the board');
      }
      return { ...board, ownerId: op.participantId };
    }

    case 'renameBoard': {
      requireFacilitator(board, actor);
      return { ...board, title: op.title };
    }

    case 'setDone': {
      if (actor.id === '') {
        return board; // a redacted echo names no one to mark
      }
      if (board.phase !== 'write') {
        fail('You can only mark yourself done while writing');
      }
      if (op.done === board.done.includes(actor.id)) {
        return board;
      }
      return {
        ...board,
        done: op.done
          ? [...board.done, actor.id]
          : board.done.filter((id) => id !== actor.id),
      };
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
