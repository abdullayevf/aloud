import { describe, expect, it } from "vitest";
import { ledgerReducer, normalizeForCompare, verbatimCount, type Utterance } from "./ledger";

const typed = (id: string, text: string) =>
  ({ type: "typed", id, text, mode: "verbatim" }) as const;
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

  it("counts only verbatim utterances", () => {
    const state = run(
      typed("1", "hello"),
      spoken("hello"),
      { type: "typed", id: "2", text: "press 2", mode: "assistant" },
      spoken("Pressing two now."),
    );
    expect(verbatimCount(state)).toEqual({ matched: 1, total: 1 });
  });
});
