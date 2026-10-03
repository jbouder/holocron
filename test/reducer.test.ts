import { describe, expect, it } from 'vitest';
import {
  actionItemsToCsv,
  boardToMarkdown,
  boardToSummary,
  exportBoard,
} from '#shared/export';
import { LIMITS } from '#shared/limits';
import { ClientMessageSchema, type Op, OpSchema } from '#shared/protocol';
import {
  anonymousIdsFor,
  arrangedCards,
  canArrange,
  canReleaseSeat,
  cardsInColumn,
  createBoard,
  isCardAuthor,
  isCardHidden,
  isCardSealed,
  isCommentAuthor,
  OpError,
  redactAnonymous,
  redactHidden,
  redactHiddenOp,
  reduce,
  upgradeBoard,
  votesFor,
  votesLeft,
  votesUsed,
} from '#shared/reducer';
import { TEMPLATES } from '#shared/templates';
import { type Actor, type Board, REACTION_EMOJI } from '#shared/types';

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
      [{ type: 'groupCards', id: 'a', targetId: 'b', groupId: 'g1' }, owner],
    ]);
    const a = board.cards.find((c) => c.id === 'a');
    const b = board.cards.find((c) => c.id === 'b');
    expect(a?.groupId).toBe('g1');
    expect(b?.groupId).toBe('g1');

    // The owner may: the group holds both Han's card and Luke's.
    const moved = reduce(
      board,
      { type: 'moveCard', id: 'b', columnId: 'col-2' },
      owner,
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
  it('locks phase to the owner by default, until the owner opens it', () => {
    expect(fresh().settings.facilitatorOnly).toBe(true);
    expect(() =>
      reduce(fresh(), { type: 'setPhase', phase: 'vote' }, han),
    ).toThrow(/owner/);
    expect(
      reduce(fresh(), { type: 'setPhase', phase: 'vote' }, owner).phase,
    ).toBe('vote');

    const open = reduce(
      fresh(),
      { type: 'updateSettings', settings: { facilitatorOnly: false } },
      owner,
    );
    expect(reduce(open, { type: 'setPhase', phase: 'vote' }, han).phase).toBe(
      'vote',
    );
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

  it('sets and clears a column prompt, on one line', () => {
    let board = reduce(
      fresh(),
      {
        type: 'setColumnPrompt',
        id: 'col-1',
        prompt: 'What  should\nwe keep?',
      },
      owner,
    );
    expect(board.columns[0].prompt).toBe('What should we keep?');
    board = reduce(
      board,
      { type: 'setColumnPrompt', id: 'col-1', prompt: '' },
      owner,
    );
    expect(board.columns[0].prompt).toBe('');
    expect(() =>
      reduce(
        board,
        { type: 'setColumnPrompt', id: 'col-x', prompt: 'Hi' },
        owner,
      ),
    ).toThrow(/gone/);
  });

  it('locks column prompts to the owner with facilitation', () => {
    const locked = reduce(
      fresh(),
      { type: 'updateSettings', settings: { facilitatorOnly: true } },
      owner,
    );
    const op: Op = { type: 'setColumnPrompt', id: 'col-1', prompt: 'Kudos' };
    expect(() => reduce(locked, op, han)).toThrow(/owner/);
    expect(reduce(locked, op, owner).columns[0].prompt).toBe('Kudos');
  });

  it('caps the prompt length in the protocol', () => {
    const ok = OpSchema.safeParse({
      type: 'setColumnPrompt',
      id: 'col-1',
      prompt: 'x'.repeat(LIMITS.columnPromptMax),
    });
    const tooLong = OpSchema.safeParse({
      type: 'setColumnPrompt',
      id: 'col-1',
      prompt: 'x'.repeat(LIMITS.columnPromptMax + 1),
    });
    const empty = OpSchema.safeParse({
      type: 'setColumnPrompt',
      id: 'col-1',
      prompt: '   ',
    });
    expect(ok.success).toBe(true);
    expect(tooLong.success).toBe(false);
    expect(empty.success).toBe(true);
  });

  it('gives new columns an empty prompt and templates their defaults', () => {
    const board = reduce(
      fresh(),
      { type: 'addColumn', id: 'col-x', title: 'Kudos' },
      owner,
    );
    expect(board.columns.at(-1)?.prompt).toBe('');
    expect(board.columns[0].prompt).toBe('What worked that we should keep?');
    for (const t of TEMPLATES) {
      if (t.id === 'blank') continue;
      for (const c of t.columns) {
        expect(c.prompt.length).toBeGreaterThan(0);
        expect(c.prompt.length).toBeLessThanOrEqual(LIMITS.columnPromptMax);
      }
    }
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
      [{ type: 'groupCards', id: 'a', targetId: 'b', groupId: 'g1' }, owner],
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
      [{ type: 'toggleActionItem', id: 'ai1' }, owner],
    ]);
    const md = boardToMarkdown(board, 0);
    expect(md).toContain('# Sprint 42');
    expect(md).toContain('## Went well');
    expect(md).toContain('- **Group** · 1 vote');
    expect(md).toContain('  - Pairing worked _(Han)_');
    expect(md).toContain('- [x] Fix the flaky test — Luke');
    expect(md).toContain('_No cards._');
    expect(md).toContain(
      '## Went well\n\n_What worked that we should keep?_\n\n- **Group**',
    );
  });

  it('leaves out an empty prompt', () => {
    const board = apply(fresh(), [
      [{ type: 'setColumnPrompt', id: 'col-1', prompt: '' }, owner],
      [{ type: 'setPhase', phase: 'discuss' }, owner],
    ]);
    expect(boardToMarkdown(board, 0)).toContain('## Went well\n\n_No cards._');
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

  it('gives columns stored before prompts existed an empty prompt', () => {
    const board = fresh();
    const old = {
      ...board,
      columns: board.columns.map(({ prompt: _p, ...c }) => c),
    };
    const upgraded = upgradeBoard(old as Board);
    expect(upgraded.columns.map((c) => c.prompt)).toEqual(['', '', '']);
  });

  it('fills in done on boards stored before it existed', () => {
    const { done: _d, ...old } = fresh();
    expect(upgradeBoard(old as Board).done).toEqual([]);
  });

  it('fills in removed on boards stored before it existed', () => {
    const { removed: _r, ...old } = fresh();
    expect(upgradeBoard(old as Board).removed).toEqual([]);
  });
});

describe('done signals', () => {
  const done: Op = { type: 'setDone', done: true };
  const undone: Op = { type: 'setDone', done: false };

  it('starts with nobody done', () => {
    expect(fresh().done).toEqual([]);
  });

  it('marks and unmarks only the actor', () => {
    let board = apply(fresh(), [
      [done, han],
      [done, luke],
    ]);
    expect(board.done).toEqual(['han', 'luke']);
    board = reduce(board, undone, han);
    expect(board.done).toEqual(['luke']);
  });

  it('ignores repeats and undoing when not done', () => {
    const board = apply(fresh(), [
      [done, han],
      [done, han],
    ]);
    expect(board.done).toEqual(['han']);
    expect(reduce(fresh(), undone, han).done).toEqual([]);
  });

  it('carries no participant id in the op, so nobody can mark someone else', () => {
    expect(
      OpSchema.safeParse({ type: 'setDone', done: true, id: 'han' }).data,
    ).toEqual({ type: 'setDone', done: true });
  });

  it('only works in Write', () => {
    const voting = reduce(fresh(), { type: 'setPhase', phase: 'vote' }, owner);
    expect(() => reduce(voting, done, han)).toThrow(OpError);
  });

  it('clears when the phase changes, and survives a no-op phase change', () => {
    const board = reduce(fresh(), done, han);
    expect(
      reduce(board, { type: 'setPhase', phase: 'write' }, owner).done,
    ).toEqual(['han']);
    const voting = reduce(board, { type: 'setPhase', phase: 'vote' }, owner);
    expect(voting.done).toEqual([]);
    const back = reduce(voting, { type: 'setPhase', phase: 'write' }, owner);
    expect(back.done).toEqual([]);
  });

  it('ignores a redacted echo', () => {
    const anon: Actor = { id: '', name: '', isOwner: false };
    expect(reduce(fresh(), done, anon).done).toEqual([]);
  });

  it('counts votes left without going negative', () => {
    let board = reduce(fresh(), { type: 'setPhase', phase: 'vote' }, owner);
    board = apply(board, [[add('a', 'One'), han]]);
    expect(votesLeft(board, 'han')).toBe(5);
    board = apply(board, [
      [{ type: 'vote', cardId: 'a' }, han],
      [{ type: 'vote', cardId: 'a' }, han],
    ]);
    expect(votesLeft(board, 'han')).toBe(3);
    board = reduce(
      board,
      { type: 'updateSettings', settings: { votesPerPerson: 1 } },
      owner,
    );
    expect(votesLeft(board, 'han')).toBe(0);
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
          cardId: 'signed',
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
    // With facilitation open, so Han edits his own links.
    let board = apply(fresh(), [
      [{ type: 'updateSettings', settings: { facilitatorOnly: false } }, owner],
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
      [{ type: 'groupCards', id: 'd', targetId: 'c', groupId: 'g1' }, owner],
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
      [{ type: 'setPhase', phase: 'discuss' }, owner],
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

describe('ownership handoff', () => {
  const seated = () =>
    apply(fresh(), [[{ type: 'setName', name: 'Han' }, han]]);

  it('moves ownership to a seated participant', () => {
    const board = reduce(
      seated(),
      { type: 'setOwner', participantId: han.id },
      owner,
    );
    expect(board.ownerId).toBe(han.id);
  });

  it('refuses anyone but the owner', () => {
    expect(() =>
      reduce(seated(), { type: 'setOwner', participantId: han.id }, han),
    ).toThrow(OpError);
  });

  it('refuses a participant who is not on the board', () => {
    expect(() =>
      reduce(fresh(), { type: 'setOwner', participantId: luke.id }, owner),
    ).toThrow('The new owner has to be on the board');
  });

  it('cannot be sent by a client', () => {
    const message = ClientMessageSchema.safeParse({
      type: 'op',
      opId: 'x',
      op: { type: 'setOwner', participantId: 'han' },
    });
    expect(message.success).toBe(false);
  });
});

/**
 * One negative case per permission rule (docs/security.md). The rules in
 * other blocks are tested where they live; this pins the rest, so an op
 * that loses its check fails here.
 */
describe('permission rules', () => {
  /** Han's two cards grouped by the owner, and one of Luke's. */
  function seeded(): Board {
    return apply(fresh(), [
      [add('h1', 'Han one'), han],
      [add('h2', 'Han two'), han],
      [add('l1', 'Luke one'), luke],
      [{ type: 'groupCards', id: 'h1', targetId: 'h2', groupId: 'g' }, owner],
      [
        {
          type: 'addComment',
          id: 'hc',
          cardId: 'h2',
          text: 'Han says',
          anonymous: false,
        },
        han,
      ],
    ]);
  }

  const facilitatorOps: Op[] = [
    { type: 'setPhase', phase: 'vote' },
    { type: 'setTimer', durationMs: LIMITS.timerMinMs, endsAt: 0 },
    { type: 'clearTimer' },
    { type: 'addColumn', id: 'col-x', title: 'Kudos' },
    { type: 'renameColumn', id: col, title: 'Mine now' },
    { type: 'setColumnPrompt', id: col, prompt: 'Mine now' },
    { type: 'deleteColumn', id: col },
    { type: 'renameBoard', title: 'Mine now' },
  ];

  it.each(facilitatorOps.map((op) => [op.type, op] as const))(
    '%s is owner-only while facilitation is locked',
    (_, op) => {
      const board = seeded();
      expect(board.settings.facilitatorOnly).toBe(true);
      expect(() => reduce(board, op, luke)).toThrow(/owner/);
      expect(() => reduce(board, op, owner)).not.toThrow();
      const open = reduce(
        board,
        { type: 'updateSettings', settings: { facilitatorOnly: false } },
        owner,
      );
      expect(() => reduce(open, op, luke)).not.toThrow();
    },
  );

  it('keeps every setting owner-only, even with facilitation open', () => {
    const open = reduce(
      seeded(),
      { type: 'updateSettings', settings: { facilitatorOnly: false } },
      owner,
    );
    for (const settings of [
      { votesPerPerson: 20 },
      { anonymousAllowed: false },
      { blurDuringWrite: false },
      { facilitatorOnly: true },
    ]) {
      expect(() =>
        reduce(open, { type: 'updateSettings', settings }, luke),
      ).toThrow(/owner/);
    }
  });

  it('locks moving, grouping and ungrouping other people’s cards', () => {
    const board = seeded();
    const refused: Op[] = [
      { type: 'moveCard', id: 'h1', columnId: 'col-2' },
      { type: 'groupCards', id: 'h1', targetId: 'h2', groupId: 'g2' },
      { type: 'ungroupCard', id: 'h1' },
    ];
    for (const op of refused) {
      expect(() => reduce(board, op, luke)).toThrow(/owner/);
      expect(() => reduce(board, op, han)).not.toThrow();
    }
  });

  it('locks grouping onto someone else’s card, which changes theirs too', () => {
    const board = seeded();
    expect(() =>
      reduce(
        board,
        { type: 'groupCards', id: 'l1', targetId: 'h1', groupId: 'n' },
        luke,
      ),
    ).toThrow(/owner/);
    expect(() =>
      reduce(
        board,
        { type: 'groupCards', id: 'l1', targetId: 'h1', groupId: 'n' },
        owner,
      ),
    ).not.toThrow();
  });

  describe('through group membership', () => {
    /** Han's h1 and Luke's l1, grouped by the owner; Luke's l2 alone. */
    function mixed(): Board {
      return apply(fresh(), [
        [add('h1', 'Han one'), han],
        [add('l1', 'Luke one'), luke],
        [add('l2', 'Luke two'), luke],
        [{ type: 'groupCards', id: 'l1', targetId: 'h1', groupId: 'g' }, owner],
      ]);
    }
    const open = (board: Board) =>
      reduce(
        board,
        { type: 'updateSettings', settings: { facilitatorOnly: false } },
        owner,
      );
    const groupOf = (board: Board, id: string) =>
      board.cards.find((c) => c.id === id)?.groupId;

    const reaching: Op[] = [
      // Moving l1 would take h1 along.
      { type: 'moveCard', id: 'l1', columnId: 'col-2' },
      // Ungrouping l1 would dissolve the group, ungrouping h1.
      { type: 'ungroupCard', id: 'l1' },
      // Grouping l1 onto l2 would pull h1 into Luke's new group.
      { type: 'groupCards', id: 'l1', targetId: 'l2', groupId: 'n' },
    ];

    it.each(reaching.map((op) => [op.type, op] as const))(
      '%s refuses to change someone else’s grouped card under the lock',
      (_, op) => {
        const board = mixed();
        expect(() => reduce(board, op, luke)).toThrow(
          /owner .* other people’s cards/,
        );
        // Han is refused too: l1 is Luke's.
        expect(() => reduce(board, { ...op, id: 'h1' } as Op, han)).toThrow(
          /owner/,
        );
        expect(() => reduce(board, op, owner)).not.toThrow();
        expect(() => reduce(open(board), op, luke)).not.toThrow();
      },
    );

    it('moves the whole group when the owner does it', () => {
      const moved = reduce(
        mixed(),
        { type: 'moveCard', id: 'l1', columnId: 'col-2' },
        owner,
      );
      const columns = Object.fromEntries(
        moved.cards.map((c) => [c.id, c.columnId]),
      );
      expect(columns).toEqual({ h1: 'col-2', l1: 'col-2', l2: col });
    });

    it('lets a member leave a larger group, which leaves the others grouped', () => {
      const board = apply(mixed(), [
        [{ type: 'groupCards', id: 'l2', targetId: 'h1', groupId: 'x' }, owner],
      ]);
      const left = reduce(board, { type: 'ungroupCard', id: 'l2' }, luke);
      expect(groupOf(left, 'l2')).toBeNull();
      expect(groupOf(left, 'h1')).toBe('g');
      expect(groupOf(left, 'l1')).toBe('g');
    });

    it('lets an author move and dissolve a group that is all theirs', () => {
      const board = apply(fresh(), [
        [add('l1', 'Luke one'), luke],
        [add('l2', 'Luke two'), luke],
        [{ type: 'groupCards', id: 'l1', targetId: 'l2', groupId: 'g' }, luke],
        [{ type: 'moveCard', id: 'l1', columnId: 'col-2' }, luke],
        [{ type: 'ungroupCard', id: 'l2' }, luke],
      ]);
      expect(board.cards.map((c) => [c.columnId, c.groupId])).toEqual([
        ['col-2', null],
        ['col-2', null],
      ]);
    });

    it('takes a redacted echo as the server already checked it', () => {
      const echo: Actor = { id: '', name: '', isOwner: false };
      for (const op of reaching) {
        expect(() => reduce(mixed(), op, echo)).not.toThrow();
      }
    });

    it('names every card an op changes, for the UI and the echo', () => {
      const board = mixed();
      const ids = (op: Op) =>
        arrangedCards(board, op)
          .map((c) => c.id)
          .sort();
      expect(ids(reaching[0])).toEqual(['h1', 'l1']);
      expect(ids(reaching[1])).toEqual(['h1', 'l1']);
      expect(ids(reaching[2])).toEqual(['h1', 'l1', 'l2']);
      expect(ids({ type: 'moveCard', id: 'l2', columnId: 'col-2' })).toEqual([
        'l2',
      ]);
      expect(ids({ type: 'moveCard', id: 'gone', columnId: 'col-2' })).toEqual(
        [],
      );
      expect(canArrange(board, reaching[0], luke)).toBe(false);
      expect(
        canArrange(board, { type: 'moveCard', id: 'l2', columnId: col }, luke),
      ).toBe(true);
    });
  });

  it('refuses a new group id that names another group', () => {
    const open = apply(fresh(), [
      [add('a', 'A'), han],
      [add('b', 'B'), han],
      [add('c', 'C'), luke],
      [add('d', 'D'), luke],
      [{ type: 'groupCards', id: 'a', targetId: 'b', groupId: 'hans' }, han],
    ]);
    // Luke groups his own cards, but asks for Han's group id.
    expect(() =>
      reduce(
        open,
        { type: 'groupCards', id: 'c', targetId: 'd', groupId: 'hans' },
        luke,
      ),
    ).toThrow('That group id is taken');
  });

  it('locks editing, ticking and deleting action items, not adding them', () => {
    const board = apply(seeded(), [
      [{ type: 'addActionItem', id: 'ai', text: 'Fix CI', owner: '' }, luke],
    ]);
    const locked: Op[] = [
      { type: 'editActionItem', id: 'ai', text: 'Nope', owner: '' },
      { type: 'toggleActionItem', id: 'ai' },
      { type: 'deleteActionItem', id: 'ai' },
    ];
    for (const op of locked) {
      expect(() => reduce(board, op, luke)).toThrow(/owner/);
      expect(() => reduce(board, op, owner)).not.toThrow();
    }
    const open = reduce(
      board,
      { type: 'updateSettings', settings: { facilitatorOnly: false } },
      owner,
    );
    for (const op of locked) {
      expect(() => reduce(open, op, luke)).not.toThrow();
    }
  });

  it('never lets the owner or another participant edit someone’s text', () => {
    const board = seeded();
    for (const actor of [owner, luke]) {
      expect(() =>
        reduce(board, { type: 'editCard', id: 'h1', text: 'x' }, actor),
      ).toThrow(/your own/);
    }
    for (const actor of [owner, luke]) {
      expect(() =>
        reduce(board, { type: 'editComment', id: 'hc', text: 'x' }, actor),
      ).toThrow(/your own/);
    }
  });

  it('lets only the author or the owner delete', () => {
    const board = seeded();
    expect(() => reduce(board, { type: 'deleteCard', id: 'h1' }, luke)).toThrow(
      /your own/,
    );
    expect(() =>
      reduce(board, { type: 'deleteComment', id: 'hc' }, luke),
    ).toThrow(/your own/);
    expect(() =>
      reduce(board, { type: 'deleteCard', id: 'h1' }, owner),
    ).not.toThrow();
    expect(() =>
      reduce(board, { type: 'deleteComment', id: 'hc' }, owner),
    ).not.toThrow();
  });

  it('gives a redacted actor no authority over anonymous items', () => {
    const board = redactAnonymous(
      apply(fresh(), [[add('anon', 'Secret', true), han]]),
    );
    const nobody: Actor = { id: '', name: '', isOwner: false };
    expect(() =>
      reduce(board, { type: 'editCard', id: 'anon', text: 'x' }, nobody),
    ).toThrow(/your own/);
    expect(() =>
      reduce(board, { type: 'deleteCard', id: 'anon' }, nobody),
    ).toThrow(/your own/);
  });

  it('caps the seats on a board', () => {
    let board = fresh();
    for (let i = board.participants.length; i < LIMITS.participantsMax; i++) {
      board = reduce(
        board,
        { type: 'setName', name: `P${i}` },
        { id: `p${i}`, name: `P${i}`, isOwner: false },
      );
    }
    expect(() =>
      reduce(
        board,
        { type: 'setName', name: 'Late' },
        { id: 'late', name: 'Late', isOwner: false },
      ),
    ).toThrow('This board is full');
  });
});

describe('sealed anonymous cards', () => {
  const sealed = () => apply(fresh(), [[add('anon', 'Secret', true), han]]);

  it('only seals anonymous cards, in Write, while blurring is on', () => {
    const board = apply(sealed(), [[add('signed', 'Mine'), han]]);
    const anon = board.cards[0];
    expect(isCardSealed(board, anon)).toBe(true);
    expect(isCardSealed(board, board.cards[1])).toBe(false);
    expect(
      isCardSealed(
        reduce(board, { type: 'setPhase', phase: 'vote' }, owner),
        anon,
      ),
    ).toBe(false);
    expect(
      isCardSealed(
        reduce(
          board,
          { type: 'updateSettings', settings: { blurDuringWrite: false } },
          owner,
        ),
        anon,
      ),
    ).toBe(false);
  });

  it('refuses the author anything that would name them on it', () => {
    const board = sealed();
    const refused: Op[] = [
      { type: 'toggleReaction', cardId: 'anon', emoji: REACTION_EMOJI[0] },
      {
        type: 'addComment',
        id: 'c',
        cardId: 'anon',
        text: 'Signed',
        anonymous: false,
      },
      {
        type: 'addComment',
        id: 'c',
        cardId: 'anon',
        text: 'Hidden',
        anonymous: true,
      },
      { type: 'addActionItem', id: 'a', text: 'Do', owner: '', cardId: 'anon' },
    ];
    for (const op of refused) {
      expect(() => reduce(board, op, han)).toThrow(/Write phase ends/);
    }
    // Still the author's to edit, move and delete.
    expect(() =>
      apply(board, [
        [{ type: 'editCard', id: 'anon', text: 'Edited' }, han],
        [{ type: 'moveCard', id: 'anon', columnId: 'col-2' }, han],
        [{ type: 'deleteCard', id: 'anon' }, han],
      ]),
    ).not.toThrow();
  });

  it('opens up when Write ends', () => {
    const board = reduce(sealed(), { type: 'setPhase', phase: 'vote' }, owner);
    const next = apply(board, [
      [
        { type: 'toggleReaction', cardId: 'anon', emoji: REACTION_EMOJI[0] },
        han,
      ],
      [
        {
          type: 'addActionItem',
          id: 'a',
          text: 'Do',
          owner: '',
          cardId: 'anon',
        },
        han,
      ],
    ]);
    expect(next.reactions).toHaveLength(1);
    expect(next.actionItems[0].cardId).toBe('anon');
  });
});

describe('blurred cards stay on the server', () => {
  const writing = () =>
    apply(fresh(), [
      [add('h', 'Han private'), han],
      [add('l', 'Luke private'), luke],
      [
        {
          type: 'addComment',
          id: 'hc',
          cardId: 'h',
          text: 'Han note',
          anonymous: false,
        },
        han,
      ],
    ]);

  it('blanks other people’s cards and their comments for each viewer', () => {
    const forLuke = redactHidden(writing(), luke);
    expect(forLuke.cards.map((c) => [c.id, c.text])).toEqual([
      ['h', ''],
      ['l', 'Luke private'],
    ]);
    expect(forLuke.comments[0].text).toBe('');
    const forOwner = redactHidden(writing(), owner);
    expect(forOwner.cards.every((c) => c.text === '')).toBe(true);
  });

  it('leaves everything once the blur lifts', () => {
    const board = reduce(writing(), { type: 'setPhase', phase: 'vote' }, owner);
    expect(redactHidden(board, luke)).toBe(board);
    const unblurred = reduce(
      writing(),
      { type: 'updateSettings', settings: { blurDuringWrite: false } },
      owner,
    );
    expect(redactHidden(unblurred, luke)).toBe(unblurred);
  });

  it('blanks the text on echoes the viewer cannot read', () => {
    const board = writing();
    const edit: Op = { type: 'editCard', id: 'h', text: 'Han private' };
    expect(redactHiddenOp(board, edit, luke)).toEqual({ ...edit, text: '' });
    expect(redactHiddenOp(board, edit, han)).toBe(edit);
    const comment: Op = { type: 'editComment', id: 'hc', text: 'Han note' };
    expect(redactHiddenOp(board, comment, luke)).toEqual({
      ...comment,
      text: '',
    });
    const add: Op = {
      type: 'addComment',
      id: 'x',
      cardId: 'h',
      text: 'y',
      anonymous: false,
    };
    expect(redactHiddenOp(board, add, luke)).toEqual({ ...add, text: '' });
  });

  it('keeps cards out of every export while they are blurred', () => {
    const board = apply(writing(), [
      [
        {
          type: 'addActionItem',
          id: 'ai',
          text: 'Follow up',
          owner: '',
          cardId: 'h',
        },
        han,
      ],
    ]);
    for (const format of ['md', 'csv', 'txt'] as const) {
      const out = exportBoard(board, format, 0);
      expect(out).not.toContain('private');
      expect(out).not.toContain('Han note');
    }
    expect(exportBoard(board, 'md', 0)).toContain(
      '_Cards are hidden until the Write phase ends._',
    );
    expect(exportBoard(board, 'csv', 0)).toContain('Follow up');
    const voting = reduce(board, { type: 'setPhase', phase: 'vote' }, owner);
    expect(exportBoard(voting, 'md', 0)).toContain('Han private');
  });
});

describe('releasing idle seats', () => {
  const idle: Actor = { id: 'idle', name: 'Idle', isOwner: false };
  const seated = () =>
    apply(fresh(), [
      [{ type: 'setName', name: 'Idle' }, idle],
      [{ type: 'setName', name: 'Han' }, han],
    ]);
  const release = (participantId: string): Op =>
    ({ type: 'releaseSeat', participantId }) as unknown as Op;
  const system: Actor = { id: '', name: '', isOwner: false };

  it('frees the seat of someone who left nothing public behind', () => {
    const board = reduce(seated(), release('idle'), system);
    expect(board.participants.map((p) => p.id)).toEqual(['owner', 'han']);
  });

  it('keeps the owner and anyone with a signed card, comment, vote, reaction or done', () => {
    const cases: Array<[string, Board]> = [
      ['owner', seated()],
      ['card', apply(seated(), [[add('c', 'Mine'), idle]])],
      [
        'comment',
        apply(seated(), [
          [add('c', 'Han'), han],
          [{ type: 'setPhase', phase: 'vote' }, owner],
          [
            {
              type: 'addComment',
              id: 'k',
              cardId: 'c',
              text: 'Yes',
              anonymous: false,
            },
            idle,
          ],
        ]),
      ],
      [
        'vote',
        apply(seated(), [
          [add('c', 'Han'), han],
          [{ type: 'setPhase', phase: 'vote' }, owner],
          [{ type: 'vote', cardId: 'c' }, idle],
        ]),
      ],
      [
        'reaction',
        apply(seated(), [
          [add('c', 'Han'), han],
          [{ type: 'setPhase', phase: 'vote' }, owner],
          [{ type: 'toggleReaction', cardId: 'c', emoji: '👍' }, idle],
        ]),
      ],
      ['done', apply(seated(), [[{ type: 'setDone', done: true }, idle]])],
    ];
    for (const [what, board] of cases) {
      const who = what === 'owner' ? 'owner' : 'idle';
      expect(canReleaseSeat(board, who), what).toBe(false);
      expect(() => reduce(board, release(who), system), what).toThrow(
        'That seat is in use',
      );
    }
  });

  it('ignores anonymous items, which stay their author’s', () => {
    const board = apply(seated(), [[add('a', 'Secret', true), idle]]);
    expect(canReleaseSeat(board, 'idle')).toBe(true);
    const released = reduce(board, release('idle'), system);
    expect(isCardAuthor(released.cards[0], idle)).toBe(true);
  });

  it('cannot be sent by a client', () => {
    expect(
      ClientMessageSchema.safeParse({
        type: 'op',
        opId: 'x',
        op: { type: 'releaseSeat', participantId: 'han' },
      }).success,
    ).toBe(false);
  });
});

describe('Markdown export escaping', () => {
  const evil: Actor = { id: 'evil', name: '<b>Mallory</b>', isOwner: false };
  const board = () =>
    apply(fresh(), [
      [{ type: 'renameBoard', title: '[Sprint](javascript:alert(1))' }, owner],
      [
        {
          type: 'renameColumn',
          id: col,
          title: '<img src=x onerror=alert(1)>',
        },
        owner,
      ],
      [
        { type: 'setColumnPrompt', id: col, prompt: '*bold* _it_ `code`' },
        owner,
      ],
      [add('a', '[click](javascript:alert(1))'), evil],
      [add('b', '- [x] fake task'), evil],
      [add('c', '1. not a list\n# not a heading'), evil],
      [{ type: 'setPhase', phase: 'discuss' }, owner],
      [
        {
          type: 'addComment',
          id: 'k',
          cardId: 'a',
          text: '<script>alert(1)</script> | cell',
          anonymous: false,
        },
        evil,
      ],
      [
        {
          type: 'addActionItem',
          id: 'ai',
          text: '![img](http://x/y.png)',
          owner: '~~Mallory~~',
          cardId: 'a',
        },
        evil,
      ],
    ]);

  it('escapes everything users write', () => {
    const out = boardToMarkdown(board(), 0);
    expect(out).toContain('# \\[Sprint\\](javascript:alert(1))');
    expect(out).toContain('## \\<img src=x onerror=alert(1)\\>');
    expect(out).toContain('_\\*bold\\* \\_it\\_ \\`code\\`_');
    expect(out).toContain(
      '- \\[click\\](javascript:alert(1)) _(\\<b\\>Mallory\\</b\\>)_',
    );
    expect(out).toContain('- \\- \\[x\\] fake task');
    expect(out).toContain('- 1\\. not a list \\# not a heading');
    expect(out).toContain(
      '  - 💬 \\<script\\>alert(1)\\</script\\> \\| cell _(\\<b\\>Mallory\\</b\\>)_',
    );
    expect(out).toContain(
      '- [ ] !\\[img\\](http://x/y.png) — \\~\\~Mallory\\~\\~',
    );
    expect(out).toContain('  - From: \\[click\\](javascript:alert(1))');
    // No unescaped HTML or link syntax survives.
    expect(out).not.toMatch(/(?<!\\)</);
    expect(out).not.toMatch(/(?<!\\)\]\(/);
  });

  it('leaves the plain-text summary readable', () => {
    const out = boardToSummary(board(), 0);
    expect(out).toContain('![img](http://x/y.png) (~~Mallory~~)');
    expect(out).not.toContain('\\');
  });

  it('treats a bare carriage return as a line break too', () => {
    const board = apply(fresh(), [
      [add('d', 'foo\r- [x] fake\r\n1. two'), han],
      [{ type: 'setPhase', phase: 'discuss' }, owner],
    ]);
    const out = boardToMarkdown(board, 0);
    expect(out).not.toContain('\r');
    expect(out).toContain('- foo - \\[x\\] fake 1. two');
  });
});

describe('removing a participant', () => {
  const remove = (participantId: string): Op => ({
    type: 'removeParticipant',
    participantId,
  });

  /** Han signs a card, writes an anonymous one, comments, reacts and votes. */
  function busy(anonymousAuthor: Actor = han): Board {
    return apply(fresh(), [
      [add('signed', 'Signed'), han],
      [add('anon', 'Secret', true), anonymousAuthor],
      [
        {
          type: 'addComment',
          id: 'c',
          cardId: 'signed',
          text: 'Hm',
          anonymous: false,
        },
        han,
      ],
      [{ type: 'toggleReaction', cardId: 'signed', emoji: '👍' }, han],
      [add('l1', 'Luke one'), luke],
      [{ type: 'toggleReaction', cardId: 'l1', emoji: '🎉' }, luke],
      [{ type: 'setPhase', phase: 'vote' }, owner],
      [{ type: 'vote', cardId: 'l1' }, han],
      [{ type: 'vote', cardId: 'l1' }, luke],
    ]);
  }

  it('takes them off, keeps their cards and comments, drops their votes and reactions', () => {
    const before = busy();
    const after = reduce(before, remove(han.id), owner);
    expect(after.participants.map((p) => p.id)).toEqual(['owner', 'luke']);
    expect(after.cards).toEqual(before.cards);
    expect(after.comments).toEqual(before.comments);
    expect(after.votes).toEqual([
      { cardId: 'l1', participantId: 'luke', count: 1 },
    ]);
    expect(after.reactions.map((r) => r.participantId)).toEqual(['luke']);
    expect(after.removed).toEqual(['han']);
  });

  it('clears their done', () => {
    const board = apply(fresh(), [
      [{ type: 'setDone', done: true }, han],
      [{ type: 'setDone', done: true }, luke],
    ]);
    expect(reduce(board, remove(han.id), owner).done).toEqual(['luke']);
  });

  it('is the owner’s alone, and never on the owner', () => {
    const board = busy();
    expect(() => reduce(board, remove(han.id), luke)).toThrow(
      'Only the board owner can remove someone',
    );
    expect(() => reduce(board, remove(owner.id), owner)).toThrow(
      'The owner cannot be removed',
    );
    expect(() => reduce(board, remove('nobody'), owner)).toThrow(
      'They are not on this board',
    );
  });

  it('keeps them off until the wipe', () => {
    const board = reduce(busy(), remove(han.id), owner);
    expect(() => reduce(board, { type: 'setName', name: 'Han' }, han)).toThrow(
      'The owner removed you from this board',
    );
    expect(() => reduce(board, add('back', 'Back'), han)).toThrow(OpError);
    expect(() => reduce(board, remove(han.id), owner)).toThrow(
      'They are not on this board',
    );
  });

  it('says nothing about who wrote an anonymous card', () => {
    // The same board with the anonymous card by Han or by Luke: after Han
    // goes, what a client can read is the same either way.
    const byHan = reduce(busy(han), remove(han.id), owner);
    const byLuke = reduce(busy(luke), remove(han.id), owner);
    expect(redactAnonymous(byHan)).toEqual(redactAnonymous(byLuke));
  });

  it('replays on a client’s redacted board to the server’s result', () => {
    const before = busy();
    const server = reduce(before, remove(han.id), owner, 9_000);
    const client = reduce(
      redactAnonymous(before),
      remove(han.id),
      owner,
      9_000,
    );
    expect(client).toEqual(redactAnonymous(server));
  });
});
