import { describe, expect, it } from "vitest";
import {
  awaitingReceipt,
  ledgerReducer,
  normalizeForCompare,
  remainderOf,
  verbatimCount,
  type Utterance,
} from "./ledger";

let nextSeq = 0;
const typed = (id: string, text: string) =>
  ({ type: "typed", id, seq: (nextSeq += 1), text }) as const;
const spoken = (text: string, interrupted = false) =>
  ({ type: "spoken", text, interrupted }) as const;

function run(...events: Parameters<typeof ledgerReducer>[1][]): Utterance[] {
  return events.reduce<Utterance[]>((s, e) => ledgerReducer(s, e), []);
}

describe("normalizeForCompare", () => {
  it("ignores whitespace, trailing punctuation and case", () => {
    expect(normalizeForCompare("  Hello   there. ")).toBe(normalizeForCompare("hello there"));
  });

  it("does NOT ignore a changed word", () => {
    expect(normalizeForCompare("I need an appointment")).not.toBe(
      normalizeForCompare("I would like to make an appointment"),
    );
  });

  it("does not leave a stray trailing space when punctuation is preceded by whitespace", () => {
    expect(normalizeForCompare("How are you ?")).toBe(normalizeForCompare("How are you?"));
  });
});

describe("ledgerReducer", () => {
  it("records a typed utterance as pending", () => {
    const state = run(typed("1", "hello"));
    expect(state[0]).toMatchObject({ typedText: "hello", spokenText: null, status: "pending" });
  });

  it("matches the spoken receipt against the oldest pending utterance", () => {
    const state = run(typed("1", "hello"), typed("2", "goodbye"), spoken("Hello."));
    expect(state[0].status).toBe("match");
    expect(state[0].spokenText).toBe("Hello.");
    expect(state[1].status).toBe("pending");
  });

  it("reports a real alteration as a mismatch instead of hiding it", () => {
    const state = run(typed("1", "make appointment"), spoken("I'd like to make an appointment."));
    expect(state[0].status).toBe("mismatch");
  });

  it("marks an interrupted reply as interrupted, not as a mismatch", () => {
    const state = run(typed("1", "the whole sentence"), spoken("the whole", true));
    expect(state[0].status).toBe("interrupted");
  });

  it("ignores a spoken receipt with nothing pending, e.g. the greeting", () => {
    expect(run(spoken("Hello. You're on a relay call."))).toEqual([]);
  });

  it("counts an interrupted verbatim utterance in the total but not the match count", () => {
    const state = run(typed("1", "the whole sentence"), spoken("the whole", true));
    expect(verbatimCount(state)).toEqual({ matched: 0, total: 1 });
  });

  it("leaves a line that has not come back yet out of the count entirely", () => {
    const state = run(typed("1", "hello"), spoken("hello"), typed("2", "still going"));
    expect(verbatimCount(state)).toEqual({ matched: 1, total: 1 });
  });

  it("carries the sequence number from the typed event onto the utterance", () => {
    const state = ledgerReducer([], { type: "typed", id: "a", seq: 7, text: "hello" });
    expect(state[0].seq).toBe(7);
  });
});

// What separates "the agent is taking a turn" from "your words are going out".
// The turn indicator is wrong without it — see lib/turn-state.ts.
describe("awaitingReceipt", () => {
  it("is false with nothing typed, and false once every line has come back", () => {
    expect(awaitingReceipt([])).toBe(false);
    expect(awaitingReceipt(run(typed("1", "hello"), spoken("hello")))).toBe(false);
  });

  it("is true from the moment a line is typed until its receipt arrives", () => {
    expect(awaitingReceipt(run(typed("1", "hello")))).toBe(true);
  });

  it("stays true while a second line is still outstanding", () => {
    const state = run(typed("1", "one"), typed("2", "two"), spoken("one"));
    expect(awaitingReceipt(state)).toBe(true);
  });
});

describe("remainderOf", () => {
  it("returns what did not get out, with the original casing and punctuation", () => {
    expect(remainderOf("Please repeat that.", "Please")).toBe("repeat that.");
  });

  it("returns nothing when the whole line was spoken", () => {
    expect(remainderOf("Please repeat that.", "Please repeat that.")).toBe("");
  });

  it("returns the whole line when nothing was spoken at all", () => {
    expect(remainderOf("Please repeat that.", "")).toBe("Please repeat that.");
  });

  it("ignores casing and punctuation differences from TTS when matching the prefix", () => {
    expect(remainderOf("Yes — that's right, call after five.", "yes that's")).toBe(
      "right, call after five.",
    );
  });

  // If the transcript is not a prefix of what was typed, we cannot know where
  // the cut fell. Offering the whole sentence again beats offering a silently
  // wrong fragment of it.
  it("hands back the whole line when the spoken text is not a prefix", () => {
    expect(remainderOf("Please repeat that.", "Something else entirely")).toBe(
      "Please repeat that.",
    );
  });

  it("hands back the whole line when the transcript diverges mid-way", () => {
    expect(remainderOf("Please repeat that.", "Please repeat those")).toBe("Please repeat that.");
  });
});
