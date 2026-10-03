import { describe, expect, it } from 'vitest';
import {
  actionItemsToCsv,
  boardToMarkdown,
  boardToSummary,
  exportBoard,
} from '#shared/export';
import { LIMITS } from '#shared/limits';
import { type Op, OpSchema } from '#shared/protocol';
import {
  anonymousIdsFor,
  cardsInColumn,
  createBoard,
  isCardAuthor,
  isCardHidden,
  isCommentAuthor,
  OpError,
  redactAnonymous,
  reduce,
  upgradeBoard,
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

  it('lets only the author edit, and the author or owner delete', () => {
    const board = apply(fresh(), [[add('c1', 'typo'), han]]);
    expect(() =>
      reduce(board, { type: 'editCard', id: 'c1', text: 'fixed' }, luke),
    ).toThrow(/own cards/);
    expect(() =>
      reduce(board, { type: 'editCard', id: 'c1', text: 'fixed' }, owner),
    ).toThrow(/own cards/);
    const edited = reduce(
      board,
      { type: 'editCard', id: 'c1', text: 'fixed' },
      han,
    );
    expect(edited.cards[0].text).toBe('fixed');
    expect(() =>
      reduce(edited, { type: 'deleteCard', id: 'c1' }, luke),
    ).toThrow(/own cards/);
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

describe('reactions', () => {
  const react = (cardId: string, emoji: '👍' | '🎉' = '👍'): Op => ({
    type: 'toggleReaction',
    cardId,
    emoji,
  });

  it('toggles one reaction per emoji per participant', () => {
    let board = apply(fresh(), [
      [add('a', 'Pairing worked'), han],
      [{ type: 'setPhase', phase: 'vote' }, owner],
      [react('a'), luke],
      [react('a', '🎉'), luke],
      [react('a'), owner],
    ]);
    expect(board.reactions).toEqual([
      { cardId: 'a', participantId: 'luke', emoji: '👍' },
      { cardId: 'a', participantId: 'luke', emoji: '🎉' },
      { cardId: 'a', participantId: 'owner', emoji: '👍' },
    ]);
    board = reduce(board, react('a'), luke);
    expect(board.reactions.filter((r) => r.participantId === 'luke')).toEqual([
      { cardId: 'a', participantId: 'luke', emoji: '🎉' },
    ]);
  });

  it('uses the actor from the server, not anything in the op', () => {
    const board = apply(fresh(), [
      [add('a', 'x'), han],
      [{ type: 'setPhase', phase: 'discuss' }, owner],
      [{ ...react('a'), participantId: 'owner' } as unknown as Op, luke],
    ]);
    expect(board.reactions[0].participantId).toBe('luke');
  });

  it('only lets the author react to a card that is still blurred', () => {
    const board = apply(fresh(), [[add('a', 'x'), han]]);
    expect(() => reduce(board, react('a'), luke)).toThrow(/Write phase/);
    expect(reduce(board, react('a'), han).reactions).toHaveLength(1);

    const unblurred = reduce(
      board,
      { type: 'updateSettings', settings: { blurDuringWrite: false } },
      owner,
    );
    expect(reduce(unblurred, react('a'), luke).reactions).toHaveLength(1);
  });

  it('leaves votes and their budget alone', () => {
    const board = apply(fresh(), [
      [add('a', 'x'), han],
      [{ type: 'setPhase', phase: 'vote' }, owner],
      [react('a'), luke],
      [react('a', '🎉'), luke],
    ]);
    expect(votesFor(board, 'a')).toBe(0);
    expect(votesUsed(board, 'luke')).toBe(0);
  });

  it('enforces the board-wide limit', () => {
    let board = apply(fresh(), [
      [add('a', 'x'), han],
      [{ type: 'setPhase', phase: 'vote' }, owner],
    ]);
    board = {
      ...board,
      reactions: Array.from({ length: LIMITS.reactionsMax }, (_, i) => ({
        cardId: 'a',
        participantId: `p${i}`,
        emoji: '👍' as const,
      })),
    };
    expect(() => reduce(board, react('a'), luke)).toThrow(/reaction limit/);
  });

  it('goes with its card or column', () => {
    const board = apply(fresh(), [
      [add('a', 'x'), han],
      [
        {
          type: 'addCard',
          id: 'b',
          columnId: 'col-2',
          text: 'y',
          anonymous: false,
        },
        han,
      ],
      [{ type: 'setPhase', phase: 'vote' }, owner],
      [react('a'), luke],
      [react('b'), luke],
      [{ type: 'deleteCard', id: 'a' }, han],
      [{ type: 'deleteColumn', id: 'col-2' }, owner],
    ]);
    expect(board.reactions).toEqual([]);
  });

  it('rejects emoji outside the fixed set', () => {
    expect(
      OpSchema.safeParse({ type: 'toggleReaction', cardId: 'a', emoji: '💩' })
        .success,
    ).toBe(false);
  });
});

describe('comments', () => {
  const comment = (
    id: string,
    cardId: string,
    text: string,
    anonymous = false,
  ): Op => ({
    type: 'addComment',
    id,
    cardId,
    text,
    anonymous,
  });
  function discussing(): Board {
    return apply(fresh(), [
      [add('a', 'Deploys were slow'), han],
      [{ type: 'setPhase', phase: 'discuss' }, owner],
    ]);
  }

  it('adds comments with the author name unless anonymous', () => {
    const board = apply(discussing(), [
      [comment('m1', 'a', 'The Tuesday deploy'), luke],
      [comment('m2', 'a', 'Same for me', true), owner],
    ]);
    expect(board.comments).toEqual([
      {
        id: 'm1',
        cardId: 'a',
        authorId: 'luke',
        authorName: 'Luke',
        anonymous: false,
        text: 'The Tuesday deploy',
        createdAt: 5_000,
        editedAt: null,
      },
      expect.objectContaining({ id: 'm2', authorName: '', anonymous: true }),
    ]);
  });

  it('ignores duplicate deliveries', () => {
    const board = apply(discussing(), [
      [comment('m1', 'a', 'x'), luke],
      [comment('m1', 'a', 'x'), luke],
    ]);
    expect(board.comments).toHaveLength(1);
  });

  it('follows the board anonymity setting', () => {
    const board = reduce(
      discussing(),
      { type: 'updateSettings', settings: { anonymousAllowed: false } },
      owner,
    );
    expect(() => reduce(board, comment('m1', 'a', 'x', true), luke)).toThrow(
      /Anonymous comments/,
    );
  });

  it('lets only the author edit, and the author or owner delete', () => {
    const board = apply(discussing(), [
      [comment('m1', 'a', 'first'), luke],
      [comment('m2', 'a', 'second'), luke],
    ]);
    expect(() =>
      reduce(board, { type: 'editComment', id: 'm1', text: 'nope' }, owner),
    ).toThrow(/own comments/);
    expect(() =>
      reduce(board, { type: 'deleteComment', id: 'm1' }, han),
    ).toThrow(/own comments/);

    const edited = reduce(
      board,
      { type: 'editComment', id: 'm1', text: 'edited' },
      luke,
      9_000,
    );
    expect(edited.comments[0]).toMatchObject({
      text: 'edited',
      editedAt: 9_000,
    });

    const after = apply(edited, [
      [{ type: 'deleteComment', id: 'm1' }, luke],
      [{ type: 'deleteComment', id: 'm2' }, owner],
    ]);
    expect(after.comments).toEqual([]);
  });

  it('only lets the author comment on a card that is still blurred', () => {
    const board = apply(fresh(), [[add('a', 'x'), han]]);
    expect(() => reduce(board, comment('m1', 'a', 'hi'), luke)).toThrow(
      /Write phase/,
    );
    expect(
      reduce(board, comment('m1', 'a', 'note'), han).comments,
    ).toHaveLength(1);
  });

  it('enforces per-card and per-board limits', () => {
    let board = discussing();
    for (let i = 0; i < LIMITS.commentsPerCardMax; i++) {
      board = reduce(board, comment(`m${i}`, 'a', 'x'), luke);
    }
    expect(() => reduce(board, comment('one-more', 'a', 'x'), luke)).toThrow(
      /card has reached/,
    );

    const full = {
      ...discussing(),
      comments: Array.from({ length: LIMITS.commentsMax }, (_, i) => ({
        id: `c${i}`,
        cardId: `elsewhere-${i}`,
        authorId: 'luke',
        authorName: 'Luke',
        anonymous: false,
        text: 'x',
        createdAt: 0,
        editedAt: null,
      })),
    };
    expect(() => reduce(full, comment('m', 'a', 'x'), luke)).toThrow(
      /board has reached/,
    );
  });

  it('caps comment length in the protocol', () => {
    const long = 'x'.repeat(LIMITS.commentTextMax + 1);
    expect(
      OpSchema.safeParse({
        type: 'addComment',
        id: 'm',
        cardId: 'a',
        text: long,
        anonymous: false,
      }).success,
    ).toBe(false);
  });

  it('goes with its card, and follows renames', () => {
    const board = apply(discussing(), [
      [comment('m1', 'a', 'x'), luke],
      [comment('m2', 'a', 'y', true), luke],
      [
        { type: 'setName', name: 'Skywalker' },
        { ...luke, name: 'Skywalker' },
      ],
    ]);
    expect(board.comments.map((c) => c.authorName)).toEqual(['Skywalker', '']);
    expect(
      reduce(board, { type: 'deleteCard', id: 'a' }, han).comments,
    ).toEqual([]);
  });
});

describe('upgradeBoard', () => {
  it('fills in reactions and comments on boards stored before they existed', () => {
    const { reactions: _r, comments: _c, ...old } = fresh();
    const upgraded = upgradeBoard(old as Board);
    expect(upgraded.reactions).toEqual([]);
    expect(upgraded.comments).toEqual([]);
  });

  it('gives action items stored before card links a null cardId', () => {
    const board = apply(fresh(), [
      [{ type: 'addActionItem', id: 'ai', text: 'Do it', owner: '' }, han],
    ]);
    const { cardId: _c, ...oldItem } = board.actionItems[0];
    const upgraded = upgradeBoard({
      ...board,
      actionItems: [oldItem as Board['actionItems'][number]],
    });
    expect(upgraded.actionItems[0].cardId).toBeNull();
  });
});

describe('export with reactions and comments', () => {
  it('puts reaction counts on the card line and comments under it', () => {
    const board = apply(fresh(), [
      [add('a', 'Pairing worked'), han],
      [add('b', 'Flaky CI'), luke],
      [add('c', 'Retro snacks'), luke],
      [{ type: 'groupCards', id: 'b', targetId: 'c', groupId: 'g1' }, luke],
      [{ type: 'setPhase', phase: 'discuss' }, owner],
      [{ type: 'vote', cardId: 'a' }, luke],
      [{ type: 'toggleReaction', cardId: 'a', emoji: '🎉' }, luke],
      [{ type: 'toggleReaction', cardId: 'a', emoji: '👍' }, owner],
      [{ type: 'toggleReaction', cardId: 'a', emoji: '👍' }, luke],
      [{ type: 'toggleReaction', cardId: 'b', emoji: '🤔' }, han],
      [
        {
          type: 'addComment',
          id: 'm1',
          cardId: 'a',
          text: 'Do it\nagain',
          anonymous: false,
        },
        owner,
      ],
      [
        {
          type: 'addComment',
          id: 'm2',
          cardId: 'b',
          text: 'Mostly Tuesday',
          anonymous: true,
        },
        han,
      ],
    ]);
    const md = boardToMarkdown(board, 0);
    expect(md).toContain(
      '- Pairing worked _(Han)_ · 1 vote · 👍 2 🎉 1\n  - 💬 Do it again _(Leia)_',
    );
    expect(md).toContain(
      '  - Flaky CI _(Luke)_ · 🤔 1\n    - 💬 Mostly Tuesday\n',
    );
  });
});

describe('anonymity', () => {
  /** A board with one anonymous card and one anonymous comment by Han. */
  function withSecrets(): Board {
    return apply(fresh(), [
      [add('signed', 'Shipped it'), han],
      [add('secret', 'I broke prod', true), han],
      [
        {
          type: 'addComment',
          id: 'whisper',
          cardId: 'secret',
          text: 'twice',
          anonymous: true,
        },
        han,
      ],
    ]);
  }

  it('redacts the author id of anonymous cards and comments, nothing else', () => {
    const redacted = redactAnonymous(withSecrets());
    expect(redacted.cards.find((c) => c.id === 'secret')).toMatchObject({
      authorId: '',
      anonymous: true,
      text: 'I broke prod',
    });
    expect(redacted.cards.find((c) => c.id === 'signed')?.authorId).toBe('han');
    expect(redacted.comments[0].authorId).toBe('');
    expect(redacted.participants.map((p) => p.id)).toContain('han');
  });

  it('lists a participant’s own anonymous items for their `you`', () => {
    expect(anonymousIdsFor(withSecrets(), 'han')).toEqual({
      anonymousCardIds: ['secret'],
      anonymousCommentIds: ['whisper'],
    });
    expect(anonymousIdsFor(withSecrets(), 'luke')).toEqual({
      anonymousCardIds: [],
      anonymousCommentIds: [],
    });
  });

  it('recognises authorship on the full and the redacted document', () => {
    const full = withSecrets();
    const redacted = redactAnonymous(full);
    const secret = (b: Board) =>
      b.cards.find((c) => c.id === 'secret') as Board['cards'][number];
    const hanClient = { ...han, ...anonymousIdsFor(full, 'han') };

    expect(isCardAuthor(secret(full), han)).toBe(true);
    expect(isCardAuthor(secret(redacted), han)).toBe(false);
    expect(isCardAuthor(secret(redacted), hanClient)).toBe(true);
    expect(isCardAuthor(secret(redacted), luke)).toBe(false);
    expect(isCardAuthor(secret(redacted), owner)).toBe(false);
    expect(isCommentAuthor(redacted.comments[0], hanClient)).toBe(true);
    expect(isCommentAuthor(redacted.comments[0], owner)).toBe(false);
  });

  it('never matches an empty author id against an empty viewer id', () => {
    const redacted = redactAnonymous(withSecrets());
    const secret = redacted.cards.find((c) => c.id === 'secret');
    const ghost = { id: '', name: '', isOwner: false };
    expect(secret && isCardAuthor(secret, ghost)).toBe(false);
    expect(() =>
      reduce(redacted, { type: 'editCard', id: 'secret', text: 'x' }, ghost),
    ).toThrow(/own cards/);
  });

  it('lets the author edit and delete their anonymous card from a redacted board', () => {
    const redacted = redactAnonymous(withSecrets());
    const hanClient: Actor = {
      ...han,
      ...anonymousIdsFor(withSecrets(), 'han'),
    };
    const edited = reduce(
      redacted,
      { type: 'editCard', id: 'secret', text: 'I fixed prod' },
      hanClient,
    );
    expect(edited.cards.find((c) => c.id === 'secret')?.text).toBe(
      'I fixed prod',
    );
    expect(() =>
      reduce(redacted, { type: 'editCard', id: 'secret', text: 'x' }, owner),
    ).toThrow(/own cards/);
    // The owner can still delete it without knowing who wrote it.
    expect(
      reduce(redacted, { type: 'deleteCard', id: 'secret' }, owner).cards,
    ).toHaveLength(1);
    const commented = reduce(
      redacted,
      { type: 'editComment', id: 'whisper', text: 'thrice' },
      hanClient,
    );
    expect(commented.comments[0].text).toBe('thrice');
  });

  it('does not blur an author’s own anonymous card on a redacted board', () => {
    const redacted = redactAnonymous(withSecrets());
    const secret = redacted.cards.find(
      (c) => c.id === 'secret',
    ) as Board['cards'][number];
    const hanClient = { ...han, ...anonymousIdsFor(withSecrets(), 'han') };
    expect(isCardHidden(redacted, secret, hanClient)).toBe(false);
    expect(isCardHidden(redacted, secret, luke)).toBe(true);
  });

  it('applies a redacted echo without seating a phantom participant', () => {
    const redacted = redactAnonymous(withSecrets());
    const echoActor: Actor = {
      id: '',
      name: '',
      isOwner: false,
      anonymousCardIds: ['later'],
    };
    const next = reduce(redacted, add('later', 'quietly', true), echoActor);
    expect(next.participants.some((p) => p.id === '')).toBe(false);
    expect(next.cards.find((c) => c.id === 'later')).toMatchObject({
      authorId: '',
      anonymous: true,
    });
    const moved = reduce(next, { type: 'deleteCard', id: 'later' }, echoActor);
    expect(moved.cards.some((c) => c.id === 'later')).toBe(false);
  });
});

describe('action items linked to cards', () => {
  const addAction = (
    id: string,
    cardId: string | null | undefined,
    text = 'Fix it',
  ): Op => ({ type: 'addActionItem', id, text, owner: '', cardId });

  it('links a new action item to a card, or to nothing', () => {
    const board = apply(fresh(), [
      [add('a', 'Flaky CI'), han],
      [addAction('ai1', 'a'), han],
      [addAction('ai2', null), luke],
      [
        { type: 'addActionItem', id: 'ai3', text: 'Old client', owner: '' },
        luke,
      ],
    ]);
    expect(board.actionItems.map((a) => a.cardId)).toEqual(['a', null, null]);
  });

  it('refuses a card that does not exist', () => {
    expect(() => apply(fresh(), [[addAction('ai', 'nope'), han]])).toThrow(
      OpError,
    );
  });

  it('refuses a card still blurred for the actor in Write', () => {
    const board = apply(fresh(), [[add('a', 'Secret'), han]]);
    expect(() => reduce(board, addAction('ai', 'a'), luke)).toThrow(OpError);
    // The author can, and anyone can once the phase moves on.
    expect(reduce(board, addAction('ai', 'a'), han).actionItems).toHaveLength(
      1,
    );
    const voting = reduce(board, { type: 'setPhase', phase: 'vote' }, owner);
    expect(
      reduce(voting, addAction('ai', 'a'), luke).actionItems[0].cardId,
    ).toBe('a');
  });

  it('edits keep the link unless one is given; null removes it', () => {
    let board = apply(fresh(), [
      [add('a', 'One'), han],
      [add('b', 'Two'), han],
      [addAction('ai', 'a'), han],
      [
        { type: 'editActionItem', id: 'ai', text: 'Renamed', owner: 'Luke' },
        han,
      ],
    ]);
    expect(board.actionItems[0]).toMatchObject({
      text: 'Renamed',
      cardId: 'a',
    });
    board = reduce(
      board,
      { type: 'editActionItem', id: 'ai', text: 'R', owner: '', cardId: 'b' },
      han,
    );
    expect(board.actionItems[0].cardId).toBe('b');
    board = reduce(
      board,
      { type: 'editActionItem', id: 'ai', text: 'R', owner: '', cardId: null },
      han,
    );
    expect(board.actionItems[0].cardId).toBeNull();
    expect(() =>
      reduce(
        board,
        { type: 'editActionItem', id: 'ai', text: 'R', owner: '', cardId: 'x' },
        han,
      ),
    ).toThrow(OpError);
  });

  it('keeps the action item but drops the link when its card goes', () => {
    const board = apply(fresh(), [
      [add('a', 'One'), han],
      [{ ...add('b', 'Two'), columnId: 'col-2' } as Op, han],
      [addAction('ai1', 'a'), han],
      [addAction('ai2', 'b'), han],
      [{ type: 'deleteCard', id: 'a' }, han],
    ]);
    expect(board.actionItems.map((a) => a.cardId)).toEqual([null, 'b']);
    const columnGone = reduce(
      board,
      { type: 'deleteColumn', id: 'col-2' },
      owner,
    );
    expect(columnGone.actionItems.map((a) => a.cardId)).toEqual([null, null]);
    expect(columnGone.actionItems).toHaveLength(2);
  });

  it('accepts cardId in the protocol, and rejects a non-string', () => {
    expect(
      OpSchema.safeParse({
        type: 'addActionItem',
        id: 'ai',
        text: 'x',
        owner: '',
        cardId: 'a',
      }).success,
    ).toBe(true);
    expect(
      OpSchema.safeParse({
        type: 'addActionItem',
        id: 'ai',
        text: 'x',
        owner: '',
        cardId: 42,
      }).success,
    ).toBe(false);
  });
});

describe('export formats', () => {
  function retro(): Board {
    return apply(fresh(), [
      [add('a', 'Deploys were slow'), han],
      [add('b', 'Nobody knew who wrote this', true), luke],
      [add('c', 'Pairing helped'), han],
      [add('d', 'Pairing again'), luke],
      [{ type: 'groupCards', id: 'd', targetId: 'c', groupId: 'g1' }, han],
      [{ type: 'setPhase', phase: 'vote' }, owner],
      [{ type: 'vote', cardId: 'b' }, han],
      [{ type: 'vote', cardId: 'b' }, han],
      [{ type: 'vote', cardId: 'b' }, luke],
      [{ type: 'vote', cardId: 'c' }, han],
      [{ type: 'vote', cardId: 'd' }, luke],
      [{ type: 'setPhase', phase: 'discuss' }, owner],
      [
        {
          type: 'addActionItem',
          id: 'ai1',
          text: 'Speed up "deploy", now',
          owner: 'Luke',
          cardId: 'a',
        },
        owner,
      ],
      [
        {
          type: 'addActionItem',
          id: 'ai2',
          text: 'Talk it through',
          owner: '',
          cardId: 'b',
        },
        owner,
      ],
      [{ type: 'toggleActionItem', id: 'ai2' }, owner],
    ]);
  }

  it('prints the linked card under an action item in Markdown, without its author', () => {
    const md = boardToMarkdown(retro(), 0);
    expect(md).toContain(
      '- [ ] Speed up "deploy", now — Luke\n  - From: Deploys were slow\n',
    );
    expect(md).toContain(
      '- [x] Talk it through\n  - From: Nobody knew who wrote this\n',
    );
    expect(md).not.toMatch(/From: .*_\(/);
  });

  it('exports action items as RFC 4180 CSV', () => {
    expect(actionItemsToCsv(retro())).toBe(
      'Summary,Owner,Done,Card\r\n' +
        '"Speed up ""deploy"", now",Luke,no,Deploys were slow\r\n' +
        'Talk it through,,yes,Nobody knew who wrote this\r\n',
    );
  });

  it('quotes newlines and defuses formula injection in CSV cells', () => {
    const board = apply(fresh(), [
      [add('a', 'line one\nline two'), han],
      [
        {
          type: 'addActionItem',
          id: 'ai1',
          text: '=HYPERLINK("http://x")',
          owner: '@han',
          cardId: 'a',
        },
        han,
      ],
      [{ type: 'addActionItem', id: 'ai2', text: '-1+2', owner: '+x' }, han],
    ]);
    const lines = actionItemsToCsv(board).split('\r\n');
    expect(lines[1]).toBe(
      `"'=HYPERLINK(""http://x"")",'@han,no,"line one\nline two"`,
    );
    expect(lines[2]).toBe("'-1+2,'+x,no,");
  });

  it('writes an empty CSV with only the header', () => {
    expect(actionItemsToCsv(fresh())).toBe('Summary,Owner,Done,Card\r\n');
  });

  it('summarises the most-voted cards and the action items as plain text', () => {
    const text = boardToSummary(retro(), Date.UTC(2026, 9, 2));
    expect(text).toBe(
      [
        'Sprint 42 · retro 2026-10-02',
        '',
        'Top voted',
        '• Nobody knew who wrote this (3 votes)',
        '• Pairing helped (+1 similar) (2 votes)',
        '',
        'Action items',
        '☐ Speed up "deploy", now (Luke)',
        '☑ Talk it through',
        '',
      ].join('\n'),
    );
    // No author names anywhere, and no Markdown.
    expect(text).not.toContain('Han');
    expect(text).not.toContain('**');
  });

  it('caps the summary at the top five and says when there are no action items', () => {
    const ops: Array<[Op, Actor]> = [];
    for (let i = 0; i < 7; i++) {
      ops.push([add(`k${i}`, `Card ${i}`), han]);
    }
    ops.push([{ type: 'setPhase', phase: 'vote' }, owner]);
    for (let i = 0; i < 7; i++) {
      ops.push([{ type: 'vote', cardId: `k${i}` }, i < 4 ? han : luke]);
    }
    const text = boardToSummary(apply(fresh(), ops), 0);
    expect(text.match(/^• /gm)).toHaveLength(5);
    expect(text).toContain('Action items\nNone yet.\n');
  });

  it('routes each format through exportBoard', () => {
    const board = retro();
    expect(exportBoard(board, 'md', 0)).toBe(boardToMarkdown(board, 0));
    expect(exportBoard(board, 'csv', 0)).toBe(actionItemsToCsv(board));
    expect(exportBoard(board, 'txt', 0)).toBe(boardToSummary(board, 0));
  });
});
