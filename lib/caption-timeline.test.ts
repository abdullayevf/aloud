// lib/caption-timeline.test.ts
import { describe, expect, it } from "vitest";
import { appendWord, inkSplit, type ReplyTimeline } from "./caption-timeline";

/** Shape measured 2026-09-25: one word per delta, trailing space included,
 * start_ms/end_ms offsets into the reply audio. Not cumulative. */
function build(): ReplyTimeline {
  let t: ReplyTimeline | null = null;
  t = appendWord(t, "r1", "I ", 296, 312);
  t = appendWord(t, "r1", "would ", 360, 457);
  t = appendWord(t, "r1", "like ", 457, 619);
  return t;
}

describe("appendWord", () => {
  it("concatenates deltas verbatim — they already carry their spacing", () => {
    expect(build().words.map((w) => w.text).join("")).toBe("I would like ");
  });

  it("starts a fresh timeline when the reply id changes, discarding the old one", () => {
    const stale = build();
    const fresh = appendWord(stale, "r2", "Hello ", 100, 200);
    expect(fresh.replyId).toBe("r2");
    expect(fresh.words).toHaveLength(1);
  });
});

describe("inkSplit", () => {
  it("inks nothing before the first word starts — the reply opens with silence", () => {
    // Measured: the first word starts at 296ms, so audio opens with ~300ms of
    // nothing. Inking during it would run the caption ahead of the voice.
    expect(inkSplit(build(), 100)).toEqual({ spoken: "", unspoken: "I would like " });
  });

  it("inks a word once it has started", () => {
    expect(inkSplit(build(), 400)).toEqual({ spoken: "I would ", unspoken: "like " });
  });

  it("inks everything once elapsed passes the last word", () => {
    expect(inkSplit(build(), 9999)).toEqual({ spoken: "I would like ", unspoken: "" });
  });

  it("inks nothing when there is no playback clock yet", () => {
    expect(inkSplit(build(), null)).toEqual({ spoken: "", unspoken: "I would like " });
  });

  it("returns empty halves for a reply whose deltas never arrived", () => {
    // A drop between the delta burst and the audio must render nothing, not
    // crash and not claim the whole line was spoken.
    expect(inkSplit(null, 500)).toEqual({ spoken: "", unspoken: "" });
  });

  it("ignores a timeline belonging to a superseded reply", () => {
    // After a barge-in the next reply is a different reply_id. A late delta
    // burst for the old one must not ink the new row.
    const stale = build();
    expect(inkSplit(stale, 400, "r2")).toEqual({ spoken: "", unspoken: "" });
  });
});
