import { describe, expect, it } from 'vitest';
import { boardToMarkdown } from '#shared/export';
import type { Op } from '#shared/protocol';
import {
  cardsInColumn,
  createBoard,
  OpError,
  reduce,
  votesFor,
  votesUsed,
} from '#shared/reducer';
import type { Actor, Board } from '#shared/types';

const owner: Actor = { id: 'owner', name: 'Leia', isOwner: true };
const han: Actor = { id: 'han', name: 'Han', isOwner: false };
const luke: Actor = { id: 'luke', name: 'Luke', isOwner: false };

function fresh(): Board {
  return createBoard({
    code: 'ABCDEF',
    title: 'Sprint 42',
    templateId: 'classic',
    ownerId: owner.id,
    ownerName: owner.name,
    createdAt: 1_000,
    expiresAt: 2_000,
  });
}

function apply(board: Board, ops: Array<[Op, Actor]>): Board {
  let next = board;
  for (const [op, actor] of ops) {
    next = reduce(next, op, actor, 5_000);
  }
  return next;
}

const col = 'col-1';
const add = (id: string, text: string, anonymous = false): Op => ({
  type: 'addCard',
  id,
  columnId: col,
  text,
  anonymous,
});

describe('createBoard', () => {
  it('builds columns from the template and seats the owner', () => {
    const board = fresh();
    expect(board.columns.map((c) => c.title)).toEqual([
      'Went well',
      'To improve',
      'Action items',
    ]);
    expect(board.participants).toEqual([
      { id: 'owner', name: 'Leia', online: false },
    ]);
    expect(board.phase).toBe('write');
  });

  it('falls back to the template name when the title is blank', () => {
    const board = createBoard({
      code: 'ABCDEF',
      title: '   ',
      templateId: 'dagobah',
      ownerId: 'o',
      ownerName: 'O',
      createdAt: 0,
      expiresAt: 1,
    });
    expect(board.title).toBe('Dagobah');
  });
});

describe('cards', () => {
  it('adds cards with the author name unless anonymous', () => {
    const board = apply(fresh(), [
      [add('c1', 'Shipped the thing'), han],
      [add('c2', 'Nobody knows I wrote this', true), luke],
    ]);
    expect(board.cards).toHaveLength(2);
    expect(board.cards[0]).toMatchObject({
      authorId: 'han',
      authorName: 'Han',
    });
    expect(board.cards[1]).toMatchObject({
      authorId: 'luke',
      authorName: '',
      anonymous: true,
    });
    expect(board.participants.map((p) => p.id)).toEqual([
      'owner',
      'han',
      'luke',
    ]);
    expect(board.cards[0].createdAt).toBe(5_000);
  });

  it('refuses anonymous cards when the board disallows them', () => {
    const board = apply(fresh(), [
      [
        { type: 'updateSettings', settings: { anonymousAllowed: false } },
        owner,
      ],
    ]);
    expect(() => reduce(board, add('c1', 'x', true), han)).toThrow(OpError);
  });

  it('only lets the author or owner edit and delete', () => {
    const board = apply(fresh(), [[add('c1', 'typo'), han]]);
    expect(() =>
      reduce(board, { type: 'editCard', id: 'c1', text: 'fixed' }, luke),
    ).toThrow(/own cards/);
    const edited = reduce(
      board,
      { type: 'editCard', id: 'c1', text: 'fixed' },
      han,
    );
    expect(edited.cards[0].text).toBe('fixed');
    const removed = reduce(edited, { type: 'deleteCard', id: 'c1' }, owner);
    expect(removed.cards).toHaveLength(0);
  });

  it('ignores duplicate deliveries of addCard', () => {
    const once = reduce(fresh(), add('c1', 'hi'), han);
    const twice = reduce(once, add('c1', 'hi'), han);
    expect(twice.cards).toHaveLength(1);
  });

  it('moves a card to another column at a position', () => {
    const board = apply(fresh(), [
      [add('a', 'a'), han],
      [add('b', 'b'), han],
      [
        {
          type: 'addCard',
          id: 'c',
          columnId: 'col-2',
          text: 'c',
          anonymous: false,
        },
        han,
      ],
    ]);
    const moved = reduce(
      board,
      { type: 'moveCard', id: 'c', columnId: col, position: 1 },
      han,
    );
    expect(cardsInColumn(moved, col).map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(cardsInColumn(moved, 'col-2')).toHaveLength(0);
  });
});

describe('grouping', () => {
  it('groups a card onto another and moves the group together', () => {
    const board = apply(fresh(), [
      [add('a', 'a'), han],
      [add('b', 'b'), luke],
      [{ type: 'groupCards', id: 'a', targetId: 'b', groupId: 'g1' }, han],
    ]);
    const a = board.cards.find((c) => c.id === 'a');
    const b = board.cards.find((c) => c.id === 'b');
    expect(a?.groupId).toBe('g1');
    expect(b?.groupId).toBe('g1');

    const moved = reduce(
      board,
      { type: 'moveCard', id: 'b', columnId: 'col-2' },
      luke,
    );
    expect(moved.cards.every((c) => c.columnId === 'col-2')).toBe(true);
  });

  it('dissolves a group that would be left with one member', () => {
    const board = apply(fresh(), [
      [add('a', 'a'), han],
      [add('b', 'b'), han],
      [{ type: 'groupCards', id: 'a', targetId: 'b', groupId: 'g1' }, han],
      [{ type: 'ungroupCard', id: 'a' }, han],
    ]);
    expect(board.cards.every((c) => c.groupId === null)).toBe(true);
  });

  it('joins an existing group instead of making a new one', () => {
    const board = apply(fresh(), [
      [add('a', 'a'), han],
      [add('b', 'b'), han],
      [add('c', 'c'), han],
      [{ type: 'groupCards', id: 'a', targetId: 'b', groupId: 'g1' }, han],
      [{ type: 'groupCards', id: 'c', targetId: 'b', groupId: 'g2' }, han],
    ]);
    expect(new Set(board.cards.map((c) => c.groupId))).toEqual(new Set(['g1']));
  });
});

describe('voting', () => {
  const withCards = () =>
    apply(fresh(), [
      [add('a', 'a'), han],
      [add('b', 'b'), luke],
      [{ type: 'setPhase', phase: 'vote' }, owner],
    ]);

  it('is closed during the Write phase', () => {
    const board = apply(fresh(), [[add('a', 'a'), han]]);
    expect(() => reduce(board, { type: 'vote', cardId: 'a' }, luke)).toThrow(
      /Write/,
    );
  });

  it('counts votes per person up to the limit, several on one card', () => {
    let board = apply(withCards(), [
      [{ type: 'updateSettings', settings: { votesPerPerson: 3 } }, owner],
    ]);
    board = apply(board, [
      [{ type: 'vote', cardId: 'a' }, luke],
      [{ type: 'vote', cardId: 'a' }, luke],
      [{ type: 'vote', cardId: 'b' }, luke],
    ]);
    expect(votesUsed(board, 'luke')).toBe(3);
    expect(votesFor(board, 'a')).toBe(2);
    expect(() => reduce(board, { type: 'vote', cardId: 'b' }, luke)).toThrow(
      /all your votes/,
    );

    board = reduce(board, { type: 'unvote', cardId: 'a' }, luke);
    expect(votesFor(board, 'a')).toBe(1);
    board = reduce(board, { type: 'unvote', cardId: 'a' }, luke);
    expect(board.votes.find((v) => v.cardId === 'a')).toBeUndefined();
  });

  it('removes votes with a deleted card', () => {
    const board = apply(withCards(), [
      [{ type: 'vote', cardId: 'a' }, luke],
      [{ type: 'deleteCard', id: 'a' }, han],
    ]);
    expect(board.votes).toHaveLength(0);
  });
});

describe('facilitation', () => {
  it('lets anyone change phase unless the owner locks it', () => {
    const open = reduce(fresh(), { type: 'setPhase', phase: 'vote' }, han);
    expect(open.phase).toBe('vote');

    const locked = reduce(
      fresh(),
      { type: 'updateSettings', settings: { facilitatorOnly: true } },
      owner,
    );
    expect(() =>
      reduce(locked, { type: 'setPhase', phase: 'vote' }, han),
    ).toThrow(/owner/);
    expect(
      reduce(locked, { type: 'setPhase', phase: 'vote' }, owner).phase,
    ).toBe('vote');
  });

  it('only the owner changes settings', () => {
    expect(() =>
      reduce(
        fresh(),
        { type: 'updateSettings', settings: { votesPerPerson: 1 } },
        han,
      ),
    ).toThrow(/owner/);
  });

  it('manages columns and keeps at least one', () => {
    let board = apply(fresh(), [
      [{ type: 'addColumn', id: 'col-x', title: 'Kudos' }, owner],
      [{ type: 'renameColumn', id: 'col-x', title: 'Shout-outs' }, owner],
    ]);
    expect(board.columns.at(-1)).toMatchObject({
      title: 'Shout-outs',
      position: 3,
    });
    board = apply(board, [
      [{ type: 'deleteColumn', id: 'col-1' }, owner],
      [{ type: 'deleteColumn', id: 'col-2' }, owner],
      [{ type: 'deleteColumn', id: 'col-3' }, owner],
    ]);
    expect(board.columns).toHaveLength(1);
    expect(() =>
      reduce(board, { type: 'deleteColumn', id: 'col-x' }, owner),
    ).toThrow(/at least one/);
  });

  it('renames a participant and their non-anonymous cards', () => {
    const board = apply(fresh(), [
      [add('a', 'signed'), han],
      [add('b', 'secret', true), han],
      [
        { type: 'setName', name: 'Solo' },
        { ...han, name: 'Solo' },
      ],
    ]);
    expect(board.participants.find((p) => p.id === 'han')?.name).toBe('Solo');
    expect(board.cards.find((c) => c.id === 'a')?.authorName).toBe('Solo');
    expect(board.cards.find((c) => c.id === 'b')?.authorName).toBe('');
  });
});

describe('action items and export', () => {
  it('round-trips into Markdown', () => {
    const board = apply(fresh(), [
      [add('a', 'Pairing worked'), han],
      [add('b', 'Flaky CI', false), luke],
      [{ type: 'groupCards', id: 'a', targetId: 'b', groupId: 'g1' }, han],
      [{ type: 'setPhase', phase: 'vote' }, owner],
      [{ type: 'vote', cardId: 'b' }, han],
      [
        {
          type: 'addActionItem',
          id: 'ai1',
          text: 'Fix the flaky test',
          owner: 'Luke',
        },
        owner,
      ],
      [{ type: 'toggleActionItem', id: 'ai1' }, han],
    ]);
    const md = boardToMarkdown(board, 0);
    expect(md).toContain('# Sprint 42');
    expect(md).toContain('## Went well');
    expect(md).toContain('- **Group** · 1 vote');
    expect(md).toContain('  - Pairing worked _(Han)_');
    expect(md).toContain('- [x] Fix the flaky test — Luke');
    expect(md).toContain('_No cards._');
  });
});
