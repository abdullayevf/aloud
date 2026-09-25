// lib/caption-timeline.test.ts
import { describe, expect, it } from "vitest";
import { appendWord, inkWords, type ReplyTimeline } from "./caption-timeline";

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

describe("inkWords", () => {
  it("marks no word current before the first one starts — the reply opens with silence", () => {
    // Measured: the first word starts at 296ms, so audio opens with ~300ms of
    // nothing. A stroke during it would run ahead of the voice.
    const ink = inkWords(build(), 100);
    expect(ink.words).toEqual(["I ", "would ", "like "]);
    expect(ink.currentIndex).toBeNull();
    expect(ink.saidCount).toBe(0);
  });

  it("makes a word current the moment it starts, not when it ends", () => {
    // 400ms is inside "would " (360..457). Waiting for endMs would leave the
    // word being said right now rendered as not-yet-said.
    const ink = inkWords(build(), 400);
    expect(ink.currentIndex).toBe(1);
    expect(ink.saidCount).toBe(1);
  });

  it("gives the stroke the current word's own measured duration and offset", () => {
    // The stroke has to cross this word in the time the voice takes over it,
    // and start part-drawn because we noticed mid-word.
    const ink = inkWords(build(), 400);
    expect(ink.currentStartMs).toBe(360);
    expect(ink.currentDurationMs).toBe(97); // 457 - 360
    expect(ink.currentElapsedMs).toBe(40); // 400 - 360
  });

  it("holds the current word through the silence before the next one", () => {
    // "I " ends at 312 and "would " starts at 360. Nothing is being spoken at
    // 330ms. Retiring the stroke there would blink it out between every pair
    // of words, which is the whole reason currentIndex holds to the next start.
    const ink = inkWords(build(), 330);
    expect(ink.currentIndex).toBe(0);
    expect(ink.saidCount).toBe(0);
  });

  it("retires the stroke once the last word is finished", () => {
    // Nothing follows the last word to hand over to, and every word really has
    // been said — so the line goes fully solid with no stroke anywhere.
    const ink = inkWords(build(), 9999);
    expect(ink.currentIndex).toBeNull();
    expect(ink.saidCount).toBe(3);
  });

  it("keeps the last word current until its own end", () => {
    const ink = inkWords(build(), 500); // inside "like " (457..619)
    expect(ink.currentIndex).toBe(2);
    expect(ink.saidCount).toBe(2);
  });

  it("knows the words but says none is current when there is no playback clock", () => {
    const ink = inkWords(build(), null);
    expect(ink.words).toEqual(["I ", "would ", "like "]);
    expect(ink.currentIndex).toBeNull();
    expect(ink.saidCount).toBe(0);
  });

  it("returns no words for a reply whose deltas never arrived", () => {
    // A drop between the delta burst and the audio must render nothing, not
    // crash and not claim the whole line was spoken. The caller tells this
    // apart from "words, none said" by the empty array, and falls back to the
    // plain typed line.
    expect(inkWords(null, 500).words).toEqual([]);
    expect(inkWords(null, 500).saidCount).toBe(0);
  });

  it("ignores a timeline belonging to a superseded reply", () => {
    // After a barge-in the next reply is a different reply_id. A late delta
    // burst for the old one must not ink the new row.
    expect(inkWords(build(), 400, "r2").words).toEqual([]);
  });

  it("never hands out a zero-length stroke", () => {
    // A zero-duration CSS animation snaps straight to complete, which reads as
    // a stroke that never moved.
    let t: ReplyTimeline | null = null;
    t = appendWord(t, "r1", "Yes.", 100, 100);
    expect(inkWords(t, 100).currentDurationMs).toBe(1);
  });
});
