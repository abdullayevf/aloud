import { describe, expect, it } from "vitest";
import { INITIAL_TURN, turnLabel, turnReducer, type TurnEvent } from "./turn-state";

const run = (...events: TurnEvent[]) => events.reduce(turnReducer, INITIAL_TURN);
/** Shorthand for the common case: nothing of ours outstanding. */
const label = (state = INITIAL_TURN, awaiting = false) => turnLabel(state, awaiting);

describe("turn state", () => {
  it("is connecting until the session is ready", () => {
    expect(label()).toBe("connecting");
    expect(label(run("ready"))).toBe("listening");
  });

  it("says they are speaking while they speak, and hands the turn back after", () => {
    expect(label(run("ready", "they-start"))).toBe("theirs");
    expect(label(run("ready", "they-start", "they-stop"))).toBe("listening");
  });

  it("says our words are going out while a reply we asked for is in flight", () => {
    expect(label(run("ready", "reply-start"), true)).toBe("yours");
    expect(label(run("ready", "reply-start", "reply-end"), true)).toBe("listening");
  });

  // The regression this whole signature exists for. The API takes a reply turn
  // after EVERY hearing-party turn — G2 measured ~2.4 s of audio and zero words
  // in those turns. With nothing of ours outstanding, that is the agent's
  // silence, and claiming it is the user's voice is the one lie this element
  // must never tell.
  it("does not claim our words are going out during the agent's own silent turn", () => {
    expect(label(run("ready", "they-start", "they-stop", "reply-start"), false)).toBe("listening");
  });

  it("recovers if a reply is never acknowledged, rather than sticking on a lie", () => {
    expect(label(run("ready", "reply-start", "reply-end"), true)).toBe("listening");
  });

  // Spec 2.1: if both are live the truthful thing to show is that they are
  // talking — the barge-in flush is about to cut our audio anyway.
  it("gives the hearing party precedence when both are live", () => {
    expect(label(run("ready", "reply-start", "they-start"), true)).toBe("theirs");
    expect(label(run("ready", "they-start", "reply-start"), true)).toBe("theirs");
  });

  it("returns to our reply if they stop before the reply finishes", () => {
    expect(label(run("ready", "reply-start", "they-start", "they-stop"), true)).toBe("yours");
  });

  it("drops everything on close so a dead call never shows a live turn", () => {
    expect(label(run("ready", "they-start", "closed"))).toBe("connecting");
  });

  it("ignores speech events that arrive before ready", () => {
    expect(label(run("they-start"))).toBe("connecting");
  });
});
