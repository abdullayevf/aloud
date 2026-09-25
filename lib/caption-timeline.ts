// lib/caption-timeline.ts
/**
 * When each word of a reply is actually spoken.
 *
 * Measured 2026-09-25 (docs/research/gate-results-2026-09-22.md): the whole
 * timeline arrives in one ~4ms burst about 365ms after the first reply.audio,
 * carrying start_ms/end_ms that span the entire reply. It is a complete map
 * delivered up front, NOT a stream that tracks playback.
 *
 * That is why nothing here depends on when deltas arrive. The ink is driven by
 * our own playback clock against this table.
 *
 * Two conventions that are easy to confuse, and are opposites:
 *   transcript.agent.delta  -> field `delta`, ONE word, NOT cumulative. Append.
 *   transcript.user.delta   -> field `text`, the full transcript so far. Replace.
 */
export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ReplyTimeline {
  replyId: string;
  words: TimedWord[];
}

/** A delta for a different reply starts a new timeline: after a barge-in the
 * next reply has its own id, and carrying words across would ink the new row
 * with the old row's sentence. */
export function appendWord(
  timeline: ReplyTimeline | null,
  replyId: string,
  delta: string,
  startMs: number,
  endMs: number,
): ReplyTimeline {
  const word: TimedWord = { text: delta, startMs, endMs };
  if (!timeline || timeline.replyId !== replyId) return { replyId, words: [word] };
  return { replyId, words: [...timeline.words, word] };
}

/**
 * Split the reply into what the voice has already said and what it has not.
 *
 * A word counts as spoken once it has STARTED. Waiting for `endMs` would leave
 * the word currently being said rendered as unspoken, which reads as the ink
 * lagging the voice.
 *
 * `expectedReplyId`, when given, guards against a late burst for a superseded
 * reply inking the current one.
 */
export function inkSplit(
  timeline: ReplyTimeline | null,
  elapsedMs: number | null,
  expectedReplyId?: string,
): { spoken: string; unspoken: string } {
  if (!timeline || timeline.words.length === 0) return { spoken: "", unspoken: "" };
  if (expectedReplyId !== undefined && timeline.replyId !== expectedReplyId) {
    return { spoken: "", unspoken: "" };
  }
  if (elapsedMs === null) {
    return { spoken: "", unspoken: timeline.words.map((w) => w.text).join("") };
  }

  let spoken = "";
  let unspoken = "";
  for (const word of timeline.words) {
    if (word.startMs <= elapsedMs) spoken += word.text;
    else unspoken += word.text;
  }
  return { spoken, unspoken };
}
