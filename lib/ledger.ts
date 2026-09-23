import type { RelayMode } from "./sentinel";

export type UtteranceStatus = "pending" | "match" | "mismatch" | "interrupted";

export interface Utterance {
  id: string;
  /** Monotonic across BOTH sides of the call, assigned by the page as each
   * item lands, so one chronological column can be built from two sources. */
  seq: number;
  typedText: string;
  spokenText: string | null;
  mode: RelayMode;
  status: UtteranceStatus;
}

export type LedgerEvent =
  | { type: "typed"; id: string; seq: number; text: string; mode: RelayMode }
  | { type: "spoken"; text: string; interrupted: boolean };

/**
 * Deliberately narrow. We forgive what TTS and transcription legitimately change
 * — surrounding whitespace, a trailing full stop, casing — and NOTHING else.
 * Widen this and the ledger stops meaning anything.
 */
export function normalizeForCompare(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .trim()
    .toLowerCase();
}

export function ledgerReducer(state: Utterance[], event: LedgerEvent): Utterance[] {
  if (event.type === "typed") {
    return [
      ...state,
      {
        id: event.id,
        seq: event.seq,
        typedText: event.text,
        spokenText: null,
        mode: event.mode,
        status: "pending",
      },
    ];
  }

  const index = state.findIndex((u) => u.status === "pending");
  if (index === -1) return state; // the greeting, or an assistant turn we did not queue

  const utterance = state[index];
  const status: UtteranceStatus = event.interrupted
    ? "interrupted"
    : normalizeForCompare(utterance.typedText) === normalizeForCompare(event.text)
      ? "match"
      : "mismatch";

  const next = [...state];
  next[index] = { ...utterance, spokenText: event.text, status };
  return next;
}

/** Per-word key for prefix matching: casing and punctuation are things TTS and
 * transcription legitimately change, so they cannot be allowed to break a
 * prefix match. Apostrophes are kept — "that's" and "thats" are different
 * enough to be worth not conflating. */
const wordKey = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * What was typed but never made it out, when a reply is cut short by the
 * hearing party talking over it.
 *
 * Returned to the composer so the natural act — press Enter again — finishes
 * the sentence. The ledger is NOT rewritten: the fragment stays logged as
 * `interrupted` and the continuation lands as its own row. Nothing is
 * retroactively edited, which is the whole basis of the receipt's credibility.
 */
export function remainderOf(typed: string, spoken: string): string {
  const spokenWords = spoken.split(/\s+/).map(wordKey).filter(Boolean);
  if (spokenWords.length === 0) return typed;

  // Tokens that are pure punctuation — a standalone em-dash, say — carry no
  // word and are never transcribed, so they must not break the prefix match.
  // They are dropped from the comparison but keep their place in the string,
  // so a dash that sits INSIDE the spoken part is consumed with it.
  const typedWords = [...typed.matchAll(/\S+/g)].filter((m) => wordKey(m[0]) !== "");
  for (let i = 0; i < spokenWords.length; i += 1) {
    const typedWord = typedWords[i];
    if (!typedWord || wordKey(typedWord[0]) !== spokenWords[i]) return typed;
  }

  const next = typedWords[spokenWords.length];
  return next ? typed.slice(next.index).trim() : "";
}

export function verbatimCount(state: Utterance[]): { matched: number; total: number } {
  const verbatim = state.filter((u) => u.mode === "verbatim" && u.status !== "pending");
  return { matched: verbatim.filter((u) => u.status === "match").length, total: verbatim.length };
}
