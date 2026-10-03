import { describe, expect, it } from 'vitest';
import { createBoard, reduce } from '#shared/reducer';
import type { Actor, Board } from '#shared/types';
import {
  ANALYSIS_MODELS,
  DEFAULT_MODEL,
  describeBoard,
  findModel,
  parseActionDrafts,
  parseGroupings,
  parseThemes,
} from '../src/lib/analysis';

const owner: Actor = { id: 'owner', name: 'Olive Owner', isOwner: true };
const member: Actor = { id: 'member', name: 'Mo Member', isOwner: false };

function fixture(): Board {
  let board = createBoard({
    code: 'ABCDEF',
    title: 'Sprint 9',
    templateId: 'went-well',
    ownerId: owner.id,
    ownerName: owner.name,
    createdAt: 1,
    expiresAt: 1_000_000,
  });
  const col1 = board.columns[0].id;
  const col2 = board.columns[1].id;
  board = reduce(
    board,
    {
      type: 'addCard',
      id: 'c1',
      columnId: col1,
      text: 'Deploys were smooth',
      anonymous: false,
    },
    owner,
    10,
  );
  board = reduce(
    board,
    {
      type: 'addCard',
      id: 'c2',
      columnId: col1,
      text: 'Pairing helped a lot',
      anonymous: true,
    },
    member,
    11,
  );
  board = reduce(
    board,
    {
      type: 'addCard',
      id: 'c3',
      columnId: col2,
      text: 'Flaky tests again',
      anonymous: false,
    },
    member,
    12,
  );
  board = reduce(board, { type: 'setPhase', phase: 'vote' }, owner, 13);
  board = reduce(board, { type: 'vote', cardId: 'c3' }, owner, 14);
  board = reduce(board, { type: 'vote', cardId: 'c3' }, member, 15);
  board = reduce(board, { type: 'setPhase', phase: 'discuss' }, owner, 16);
  board = reduce(
    board,
    {
      type: 'addComment',
      id: 'k1',
      cardId: 'c3',
      text: 'Mostly the e2e suite',
      anonymous: false,
    },
    member,
    17,
  );
  return board;
}

describe('describeBoard', () => {
  it('lays the board out by column with votes, comments and refs', () => {
    const { text, refs, omitted } = describeBoard(fixture());
    expect(omitted).toBe(0);
    expect(text).toContain('Board: Sprint 9');
    expect(text).toMatch(/Column: Went well/);
    expect(text).toMatch(/Column: To improve/);
    expect(text).toContain('[C1] (0 votes) Deploys were smooth');
    expect(text).toContain('[C2] (0 votes) Pairing helped a lot');
    expect(text).toContain('[C3] (2 votes) Flaky tests again');
    expect(text).toContain('· comment: Mostly the e2e suite');
    expect(refs.get('C1')).toBe('c1');
    expect(refs.get('C3')).toBe('c3');
    expect(refs.size).toBe(3);
  });

  it('never mentions a name or a participant id', () => {
    const board = fixture();
    const { text } = describeBoard(board);
    expect(text).not.toContain('Olive');
    expect(text).not.toContain('Owner');
    expect(text).not.toContain('Mo Member');
    expect(text).not.toContain('member');
    expect(text).not.toContain('owner');
    // Not even the card ids: only the short refs.
    expect(text).not.toMatch(/\bc[123]\b/);
  });

  it('notes which cards are already stacked', () => {
    let board = fixture();
    board = reduce(
      board,
      { type: 'groupCards', id: 'c2', targetId: 'c1', groupId: 'g1' },
      owner,
      20,
    );
    const { text } = describeBoard(board);
    expect(text).toContain('[C1] (0 votes; grouped with C2)');
    expect(text).toContain('[C2] (0 votes; grouped with C1)');
  });

  it('keeps the most-voted cards when the board is too big', () => {
    let board = fixture();
    const col = board.columns[0].id;
    for (let i = 0; i < 80; i++) {
      board = reduce(
        board,
        {
          type: 'addCard',
          id: `big-${i}`,
          columnId: col,
          text: `Card ${i} ${'x'.repeat(400)}`,
          anonymous: false,
        },
        member,
        100 + i,
      );
    }
    const { text, refs, omitted } = describeBoard(board);
    expect(omitted).toBeGreaterThan(0);
    expect(refs.size + omitted).toBe(board.cards.length);
    expect(text.length).toBeLessThan(8000);
    // The voted card made the cut.
    expect([...refs.values()]).toContain('c3');
    // Long cards are clipped.
    expect(text).not.toContain('x'.repeat(300));
  });
});

describe('parsers', () => {
  const refs = new Map([
    ['C1', 'c1'],
    ['C2', 'c2'],
    ['C3', 'c3'],
  ]);

  it('reads themes and maps refs back to card ids', () => {
    const raw = JSON.stringify({
      themes: [
        {
          title: 'Testing',
          summary: 'Tests are flaky',
          cards: ['C3', '[c3]', 'C9'],
        },
        { title: 'Flow', summary: '', cards: ['1', 'C2'] },
        { title: '', summary: 'no title', cards: [] },
      ],
    });
    expect(parseThemes(raw, refs)).toEqual([
      { title: 'Testing', summary: 'Tests are flaky', cardIds: ['c3'] },
      { title: 'Flow', summary: '', cardIds: ['c1', 'c2'] },
    ]);
  });

  it('tolerates fences and chatter around the JSON', () => {
    const raw =
      'Sure! ```json\n{"themes":[{"title":"A","summary":"b","cards":["C1"]}]}\n``` hope that helps';
    expect(parseThemes(raw, refs)).toEqual([
      { title: 'A', summary: 'b', cardIds: ['c1'] },
    ]);
    expect(parseThemes('not json at all', refs)).toEqual([]);
    expect(parseThemes('{"themes": "nope"}', refs)).toEqual([]);
  });

  it('keeps only groupings with two known cards not already stacked', () => {
    let board = fixture();
    board = reduce(
      board,
      { type: 'groupCards', id: 'c2', targetId: 'c1', groupId: 'g1' },
      owner,
      20,
    );
    const raw = JSON.stringify({
      groups: [
        { title: 'Already', cards: ['C1', 'C2'] },
        { title: 'One', cards: ['C3'] },
        { title: 'Unknown', cards: ['C7', 'C8'] },
        { title: 'New', cards: ['C3', 'C1', 'C3'] },
      ],
    });
    expect(parseGroupings(raw, refs, board.cards)).toEqual([
      { title: 'New', cardIds: ['c3', 'c1'] },
    ]);
  });

  it('reads action drafts with an optional card', () => {
    const raw = JSON.stringify({
      actions: [
        { text: 'Quarantine the e2e suite', card: 'C3' },
        { text: 'Keep pairing', card: 'C42' },
        { text: '   ', card: 'C1' },
        { text: 'No card', card: null },
      ],
    });
    expect(parseActionDrafts(raw, refs)).toEqual([
      { text: 'Quarantine the e2e suite', cardId: 'c3' },
      { text: 'Keep pairing', cardId: null },
      { text: 'No card', cardId: null },
    ]);
  });
});

describe('findModel', () => {
  it('returns the stored pick, or the default for anything else', () => {
    expect(findModel(ANALYSIS_MODELS[1].id)).toBe(ANALYSIS_MODELS[1]);
    expect(findModel(null)).toBe(DEFAULT_MODEL);
    expect(findModel('Llama-2-7b-chat-hf-q4f16_1')).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe(ANALYSIS_MODELS[0]);
  });
});
