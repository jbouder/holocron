import { z } from 'zod';
import { LIMITS } from './limits';
import { type Board, type Participant, REACTION_EMOJI } from './types';

/**
 * Everything that crosses the WebSocket, validated with zod on the server and
 * typed on the client. Ops are the only way a board changes.
 */

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().min(1).max(max);

export const OpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('addCard'),
    id,
    columnId: id,
    text: text(LIMITS.cardTextMax),
    anonymous: z.boolean(),
  }),
  z.object({
    type: z.literal('editCard'),
    id,
    text: text(LIMITS.cardTextMax),
  }),
  z.object({ type: z.literal('deleteCard'), id }),
  z.object({
    type: z.literal('moveCard'),
    id,
    columnId: id,
    /** Index within the column's top-level stacks; omitted means "the end". */
    position: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal('groupCards'),
    /** The card being dropped. */
    id,
    /** The card it was dropped on. */
    targetId: id,
    /** Group id to use if the target is not already in a group. */
    groupId: id,
  }),
  z.object({ type: z.literal('ungroupCard'), id }),
  z.object({ type: z.literal('vote'), cardId: id }),
  z.object({ type: z.literal('unvote'), cardId: id }),
  /** Adds the actor's reaction, or removes it if they already reacted. */
  z.object({
    type: z.literal('toggleReaction'),
    cardId: id,
    emoji: z.enum(REACTION_EMOJI),
  }),
  z.object({
    type: z.literal('addComment'),
    id,
    cardId: id,
    text: text(LIMITS.commentTextMax),
    anonymous: z.boolean(),
  }),
  z.object({
    type: z.literal('editComment'),
    id,
    text: text(LIMITS.commentTextMax),
  }),
  z.object({ type: z.literal('deleteComment'), id }),
  z.object({
    type: z.literal('setPhase'),
    phase: z.enum(['write', 'vote', 'discuss']),
  }),
  z.object({
    type: z.literal('setTimer'),
    durationMs: z.number().int().min(LIMITS.timerMinMs).max(LIMITS.timerMaxMs),
    /** Set by the server when it applies the op; clients send their clock. */
    endsAt: z.number().int(),
  }),
  z.object({ type: z.literal('clearTimer') }),
  z.object({
    type: z.literal('addColumn'),
    id,
    title: text(LIMITS.columnTitleMax),
  }),
  z.object({
    type: z.literal('renameColumn'),
    id,
    title: text(LIMITS.columnTitleMax),
  }),
  z.object({
    type: z.literal('setColumnPrompt'),
    id,
    /** Empty clears the prompt. */
    prompt: z.string().trim().max(LIMITS.columnPromptMax),
  }),
  z.object({ type: z.literal('deleteColumn'), id }),
  z.object({
    type: z.literal('addActionItem'),
    id,
    text: text(LIMITS.actionTextMax),
    owner: z.string().trim().max(LIMITS.nameMax),
  }),
  z.object({
    type: z.literal('editActionItem'),
    id,
    text: text(LIMITS.actionTextMax),
    owner: z.string().trim().max(LIMITS.nameMax),
  }),
  z.object({ type: z.literal('toggleActionItem'), id }),
  z.object({ type: z.literal('deleteActionItem'), id }),
  z.object({
    type: z.literal('updateSettings'),
    settings: z
      .object({
        votesPerPerson: z
          .number()
          .int()
          .min(LIMITS.votesPerPersonMin)
          .max(LIMITS.votesPerPersonMax),
        anonymousAllowed: z.boolean(),
        blurDuringWrite: z.boolean(),
        facilitatorOnly: z.boolean(),
      })
      .partial(),
  }),
  z.object({
    type: z.literal('renameBoard'),
    title: text(LIMITS.titleMax),
  }),
  z.object({ type: z.literal('setName'), name: text(LIMITS.nameMax) }),
]);

export type Op = z.infer<typeof OpSchema>;
export type OpType = Op['type'];

/** Client → server. */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('op'),
    /** Client-chosen id so the sender can match the echo or the rejection. */
    opId: id,
    op: OpSchema,
  }),
  /** Ask for a fresh snapshot (after a sequence gap). */
  z.object({ type: z.literal('sync') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** What the server knows about the connected participant. */
export interface You {
  id: string;
  name: string;
  isOwner: boolean;
  /** Anonymous cards and comments this participant wrote (see `Actor`). */
  anonymousCardIds: string[];
  anonymousCommentIds: string[];
}

/**
 * Who performed a broadcast op. When the op touches an anonymous card or
 * comment by its own author, everyone but the author receives an empty `id`
 * and `name`, and the id list names the item instead, so the echo reveals
 * nothing the document does not.
 */
export interface OpActor {
  id: string;
  name: string;
  anonymousCardIds?: string[];
  anonymousCommentIds?: string[];
}

/** Server → client. Not validated on the client; the server is trusted. */
export type ServerMessage =
  | { type: 'snapshot'; board: Board; seq: number; you: You }
  | {
      type: 'op';
      seq: number;
      op: Op;
      opId: string;
      actor: OpActor;
      /** Server clock when the op was applied; pass to `reduce`. */
      at: number;
    }
  | { type: 'presence'; participants: Participant[] }
  | { type: 'rejected'; opId: string; reason: string }
  | { type: 'deleted' }
  | { type: 'expired' };

/** Responses of the HTTP endpoints. */
export interface CreateBoardResponse {
  code: string;
  ownerToken: string;
  expiresAt: number;
}

/** The Turnstile action for board creation; Siteverify must echo it back. */
export const TURNSTILE_ACTION = 'create-board';

/** Deployment-wide facts the UI shows (the Help page, the home footer). */
export interface AppConfig {
  resetTimeZone: string;
  resetHour: number;
  /** e.g. "6:00 AM EDT" */
  resetLabel: string;
  /** Set when board creation requires a Turnstile check. */
  turnstileSiteKey: string | null;
}

export interface BoardMeta {
  code: string;
  title: string;
  expiresAt: number;
  participants: number;
  cards: number;
}
