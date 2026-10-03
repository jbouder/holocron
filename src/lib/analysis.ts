import { z } from 'zod';
import { LIMITS } from '#shared/limits';
import { votesFor } from '#shared/reducer';
import type { Board, Card } from '#shared/types';

/**
 * The owner-only Analysis panel: what the local model is told about the
 * board, and how its answers are read back into cards. Pure, so it is tested
 * without a GPU; the model itself lives behind `analysis-engine.ts`.
 *
 * Privacy rule: the prompt carries card text, column titles and prompts,
 * vote counts and comment text. Never an author name, never a participant
 * id. Cards are cited by a short reference ("C3") that exists only for the
 * duration of one request.
 */

export interface AnalysisModel {
  /** A `model_id` from WebLLM's prebuilt list. */
  id: string;
  name: string;
  /** Weights plus runtime, as the owner sees it before agreeing. */
  downloadLabel: string;
  /** GPU memory it needs once loaded. */
  vramLabel: string;
  /** Who it suits, in one line. */
  note: string;
}

/** Where the weights come from; the board is never sent there. */
export const MODEL_SOURCE = 'Hugging Face';

/**
 * The models the owner may pick from, smallest first. All are 4-bit Qwen3
 * builds; the sizes are WebLLM's own figures, rounded.
 */
export const ANALYSIS_MODELS: readonly AnalysisModel[] = [
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    name: 'Qwen3 1.7B',
    downloadLabel: 'about 1 GB',
    vramLabel: '2 GB',
    note: 'Quick, and good enough for most boards. Runs on most laptops.',
  },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    name: 'Qwen3 4B',
    downloadLabel: 'about 2.4 GB',
    vramLabel: '3.5 GB',
    note: 'Sharper themes and action items. Slower on integrated graphics.',
  },
  {
    id: 'Qwen3-8B-q4f16_1-MLC',
    name: 'Qwen3 8B',
    downloadLabel: 'about 4.6 GB',
    vramLabel: '6 GB',
    note: 'Needs a discrete GPU, or a Mac with 16 GB of memory or more.',
  },
];

export const DEFAULT_MODEL = ANALYSIS_MODELS[0];

/** The model for a stored choice; the default when it is unknown or stale. */
export function findModel(id: string | null | undefined): AnalysisModel {
  return ANALYSIS_MODELS.find((m) => m.id === id) ?? DEFAULT_MODEL;
}

export type AnalysisAction = 'themes' | 'groupings' | 'actions';

export interface Theme {
  title: string;
  summary: string;
  cardIds: string[];
}

export interface Grouping {
  title: string;
  cardIds: string[];
}

export interface ActionDraft {
  text: string;
  cardId: string | null;
}

/** The model's window is 4k tokens; the answer needs room too. */
const CONTEXT_MAX_CHARS = 7000;
const CARD_MAX_CHARS = 200;
const COMMENT_MAX_CHARS = 120;
const COMMENTS_PER_CARD = 3;
const MAX_SUGGESTIONS = 8;

export interface BoardContext {
  text: string;
  /** Short reference ("C3") → card id, for reading citations back. */
  refs: ReadonlyMap<string, string>;
  /** Cards that did not fit the model's window. */
  omitted: number;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The board as the model sees it. The most-voted cards go first when there
 * are more than fit, then everything is laid out column by column with
 * numbered references. Names and ids never appear.
 */
export function describeBoard(board: Board): BoardContext {
  const votes = new Map(board.cards.map((c) => [c.id, votesFor(board, c.id)]));
  const columns = [...board.columns].sort((a, b) => a.position - b.position);
  const columnOrder = new Map(columns.map((c, i) => [c.id, i]));

  // Pick which cards fit, most-voted first.
  const ranked = [...board.cards].sort(
    (a, b) =>
      (votes.get(b.id) ?? 0) - (votes.get(a.id) ?? 0) ||
      a.createdAt - b.createdAt,
  );
  const lines = new Map<string, string[]>();
  let budget = CONTEXT_MAX_CHARS;
  const chosen: Card[] = [];
  for (const card of ranked) {
    const own = [clip(card.text, CARD_MAX_CHARS)];
    const comments = board.comments
      .filter((c) => c.cardId === card.id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, COMMENTS_PER_CARD)
      .map((c) => `  · comment: ${clip(c.text, COMMENT_MAX_CHARS)}`);
    const cost = own[0].length + comments.join('').length + 24;
    if (cost > budget) {
      continue;
    }
    budget -= cost;
    lines.set(card.id, [...own, ...comments]);
    chosen.push(card);
  }

  // Then lay them out in board order, so the references read top to bottom.
  chosen.sort(
    (a, b) =>
      (columnOrder.get(a.columnId) ?? 0) - (columnOrder.get(b.columnId) ?? 0) ||
      (votes.get(b.id) ?? 0) - (votes.get(a.id) ?? 0) ||
      a.position - b.position ||
      a.createdAt - b.createdAt,
  );
  const refs = new Map<string, string>();
  const refOf = new Map<string, string>();
  chosen.forEach((card, i) => {
    refs.set(`C${i + 1}`, card.id);
    refOf.set(card.id, `C${i + 1}`);
  });

  const out: string[] = [`Board: ${clip(board.title, 80)}`];
  for (const column of columns) {
    const cards = chosen.filter((c) => c.columnId === column.id);
    out.push('', `Column: ${clip(column.title, LIMITS.columnTitleMax)}`);
    if (column.prompt) {
      out.push(`Prompt: ${clip(column.prompt, LIMITS.columnPromptMax)}`);
    }
    if (cards.length === 0) {
      out.push('(no cards)');
      continue;
    }
    for (const card of cards) {
      const [text, ...comments] = lines.get(card.id) ?? [''];
      const n = votes.get(card.id) ?? 0;
      const notes = [`${n} ${n === 1 ? 'vote' : 'votes'}`];
      if (card.groupId !== null) {
        const peers = chosen
          .filter((c) => c.groupId === card.groupId && c.id !== card.id)
          .map((c) => refOf.get(c.id))
          .filter((r): r is string => r !== undefined);
        if (peers.length > 0) {
          notes.push(`grouped with ${peers.join(', ')}`);
        }
      }
      out.push(`- [${refOf.get(card.id)}] (${notes.join('; ')}) ${text}`);
      out.push(...comments);
    }
  }

  return {
    text: out.join('\n'),
    refs,
    omitted: board.cards.length - chosen.length,
  };
}

export const SYSTEM_PROMPT = [
  'You help a facilitator run a team retrospective.',
  'You are given the board: its columns, the cards in each with their vote counts, and any comments.',
  'Cards are referenced as C1, C2 and so on; cite them by that reference only.',
  'Never invent cards. Be concrete and brief. Answer with JSON only, in the exact shape requested.',
].join(' ');

/** What each action asks for, and the shape the model must answer in. */
export const ACTION_PROMPTS: Record<
  AnalysisAction,
  { instruction: string; schema: Record<string, unknown> }
> = {
  themes: {
    instruction: `Summarise the themes on this board: the patterns across cards, the problems as well as the wins. Give between 2 and ${MAX_SUGGESTIONS} themes, most important first, and make sure every column that has cards appears in at least one theme. A theme has a short title, a one-sentence summary in your own words (not a card's text), and the references of the cards it is based on. Answer as {"themes":[{"title":"","summary":"","cards":["C1"]}]}.`,
    schema: {
      type: 'object',
      properties: {
        themes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              summary: { type: 'string' },
              cards: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'summary', 'cards'],
          },
        },
      },
      required: ['themes'],
    },
  },
  groupings: {
    instruction: `Suggest which cards say the same thing and should be stacked together. Give at most ${MAX_SUGGESTIONS} groups of two or more cards from the same column, each with a short title. Skip cards that are already grouped with each other. Answer as {"groups":[{"title":"","cards":["C1","C2"]}]}.`,
    schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              cards: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'cards'],
          },
        },
      },
      required: ['groups'],
    },
  },
  actions: {
    instruction: `Draft action items the team could commit to next sprint. Focus on what should change: the most-voted cards and the cards that describe problems. Give at most ${MAX_SUGGESTIONS}, most valuable first. Each is one specific, doable instruction in the imperative, starting with a verb (for example "Quarantine the flaky end-to-end tests"), not a description of what already happened, and names the reference of the card it comes from. Answer as {"actions":[{"text":"","card":"C1"}]}.`,
    schema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              card: { type: 'string' },
            },
            required: ['text', 'card'],
          },
        },
      },
      required: ['actions'],
    },
  },
};

/** The model's answer as JSON, tolerating fences and chatter around it. */
function parseJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], raw];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    candidates.push(raw.slice(start, end + 1));
  }
  for (const text of candidates) {
    if (!text) {
      continue;
    }
    try {
      return JSON.parse(text);
    } catch {
      // try the next shape
    }
  }
  return null;
}

/** "C3", "[c3]", " 3 " → "C3". */
function normaliseRef(value: string): string {
  const bare = value.replace(/[[\]\s]/g, '').toUpperCase();
  return /^\d+$/.test(bare) ? `C${bare}` : bare;
}

/** Card ids for a list of references, in order, unknown ones dropped. */
function cardIdsFor(
  refList: readonly string[] | undefined,
  refs: ReadonlyMap<string, string>,
): string[] {
  const ids: string[] = [];
  for (const ref of refList ?? []) {
    const id = refs.get(normaliseRef(ref));
    if (id !== undefined && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

const str = z.string().catch('');
const strList = z.array(z.string().catch('')).catch([]);

const ThemesSchema = z.object({
  themes: z
    .array(
      z.object({
        title: str,
        summary: str,
        cards: strList,
      }),
    )
    .catch([]),
});

const GroupingsSchema = z.object({
  groups: z
    .array(
      z.object({
        title: str,
        cards: strList,
      }),
    )
    .catch([]),
});

const ActionsSchema = z.object({
  actions: z
    .array(
      z.object({
        text: str,
        card: z.string().nullable().catch(null),
      }),
    )
    .catch([]),
});

export function parseThemes(
  raw: string,
  refs: ReadonlyMap<string, string>,
): Theme[] {
  const parsed = ThemesSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    return [];
  }
  return parsed.data.themes
    .map((t) => ({
      title: clip(t.title, 80),
      summary: clip(t.summary, 300),
      cardIds: cardIdsFor(t.cards, refs),
    }))
    .filter((t) => t.title !== '')
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Groups with at least two known cards that are not already stacked
 * together. Cards still blurred or deleted since are simply not cited.
 */
export function parseGroupings(
  raw: string,
  refs: ReadonlyMap<string, string>,
  cards: readonly Card[],
): Grouping[] {
  const parsed = GroupingsSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    return [];
  }
  const groupOf = new Map(cards.map((c) => [c.id, c.groupId]));
  return parsed.data.groups
    .map((g) => ({
      title: clip(g.title, 80),
      cardIds: cardIdsFor(g.cards, refs),
    }))
    .filter((g) => {
      if (g.cardIds.length < 2) {
        return false;
      }
      const first = groupOf.get(g.cardIds[0]);
      return (
        first === null ||
        first === undefined ||
        g.cardIds.some((id) => groupOf.get(id) !== first)
      );
    })
    .slice(0, MAX_SUGGESTIONS);
}

export function parseActionDrafts(
  raw: string,
  refs: ReadonlyMap<string, string>,
): ActionDraft[] {
  const parsed = ActionsSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    return [];
  }
  return parsed.data.actions
    .map((a) => ({
      text: clip(a.text, LIMITS.actionTextMax),
      cardId: a.card === null ? null : (cardIdsFor([a.card], refs)[0] ?? null),
    }))
    .filter((a) => a.text !== '')
    .slice(0, MAX_SUGGESTIONS);
}
