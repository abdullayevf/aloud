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
 * The reply split into three runs for rendering: what the voice has already
 * said, the ONE word it is saying right now, and what it has not reached.
 *
 * This replaced a two-way `spoken`/`unspoken` split. The two-way split told the
 * user how far the voice had got but not where it was — on a long line the
 * boundary between solid and grey is the only cue, and it is a boundary between
 * two walls of text, not a mark on a word. Naming the current word lets the
 * screen put a stroke under it and lets the eye follow the voice word by word.
 *
 * The gap problem, and why `currentIndex` holds through it: the measured
 * timings are not contiguous. "I " ends at 312ms and "would " starts at 360ms
 * (docs/research/gate-results-2026-09-22.md). A word that were current only
 * between its own `startMs` and `endMs` would leave 48ms with no word current
 * at all, and the stroke would blink out between every pair of words. So a word
 * is current from its `startMs` until the NEXT word's `startMs`: the stroke
 * finishes at `endMs`, then holds complete through the silence, then hands over.
 *
 * The last word is the exception — nothing follows it to hand over to, so it
 * retires at its own `endMs` and the line goes fully solid with no stroke. That
 * is the true statement at that point: every word has been said.
 *
 * A word becomes current when it STARTS, never when it ends. Waiting for
 * `endMs` would leave the word being said right now rendered as not-yet-said,
 * which reads as the whole ink lagging the voice.
 *
 * `expectedReplyId`, when given, guards against a late burst for a superseded
 * reply inking the current one. No call site gives one today: an utterance is
 * keyed by a local `crypto.randomUUID()`, not by the provider's `reply_id`.
 * `app/page.tsx` clears the timeline on send and on reply-start instead.
 */
export interface InkedWords {
  /** Every word of the reply, in order, spacing included as delivered. */
  words: string[];
  /** How many leading words the voice is fully past. Rendered solid. */
  saidCount: number;
  /** The word being spoken now, or null before the first word and after the
   * last. Never inside `saidCount`. */
  currentIndex: number | null;
  /** The current word's own `startMs`. The caller needs it to work out how far
   * into the stroke a frozen row had got. */
  currentStartMs: number;
  /** The stroke's full length: the current word's own measured duration, so a
   * long word is underlined slowly and a short one quickly. */
  currentDurationMs: number;
  /** How far into the stroke we already are at this sample. Used once, to start
   * the CSS animation mid-stroke rather than from zero. */
  currentElapsedMs: number;
}

const NONE: InkedWords = {
  words: [],
  saidCount: 0,
  currentIndex: null,
  currentStartMs: 0,
  currentDurationMs: 0,
  currentElapsedMs: 0,
};

export function inkWords(
  timeline: ReplyTimeline | null,
  elapsedMs: number | null,
  expectedReplyId?: string,
): InkedWords {
  if (!timeline || timeline.words.length === 0) return NONE;
  if (expectedReplyId !== undefined && timeline.replyId !== expectedReplyId) return NONE;

  const words = timeline.words.map((w) => w.text);
  // No clock yet: the words are known, none has been said. Not NONE — the
  // caller distinguishes "no timeline" (render the plain typed line) from
  // "timeline, nothing spoken yet" (render it all as not-yet-said).
  if (elapsedMs === null) return { ...NONE, words };

  let current: number | null = null;
  for (let i = 0; i < timeline.words.length; i += 1) {
    if (timeline.words[i].startMs <= elapsedMs) current = i;
    else break;
  }

  if (current === null) return { ...NONE, words };

  const word = timeline.words[current];
  // Past the end of the last word: the reply is spoken. Every word solid, no
  // stroke left on screen.
  if (current === timeline.words.length - 1 && elapsedMs > word.endMs) {
    return { ...NONE, words, saidCount: words.length };
  }

  return {
    words,
    saidCount: current,
    currentIndex: current,
    currentStartMs: word.startMs,
    // Never zero: a zero-length stroke would divide by zero downstream and a
    // zero-duration CSS animation snaps to complete, which reads as the stroke
    // never moving. One millisecond floor keeps both honest.
    currentDurationMs: Math.max(1, word.endMs - word.startMs),
    currentElapsedMs: elapsedMs - word.startMs,
  };
}
