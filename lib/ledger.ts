import type { RelayMode } from "./sentinel";

export type UtteranceStatus = "pending" | "match" | "mismatch" | "interrupted";

export interface Utterance {
  id: string;
  typedText: string;
  spokenText: string | null;
  mode: RelayMode;
  status: UtteranceStatus;
}

export type LedgerEvent =
  | { type: "typed"; id: string; text: string; mode: RelayMode }
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
      { id: event.id, typedText: event.text, spokenText: null, mode: event.mode, status: "pending" },
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

export function verbatimCount(state: Utterance[]): { matched: number; total: number } {
  const verbatim = state.filter((u) => u.mode === "verbatim" && u.status !== "pending");
  return { matched: verbatim.filter((u) => u.status === "match").length, total: verbatim.length };
}
