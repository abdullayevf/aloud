import { describe, expect, it } from "vitest";
import { INITIAL_TURN, turnLabel, turnReducer, type TurnEvent } from "./turn-state";

const run = (...events: TurnEvent[]) => events.reduce(turnReducer, INITIAL_TURN);

describe("turn state", () => {
  it("is connecting until the session is ready", () => {
    expect(turnLabel(INITIAL_TURN)).toBe("connecting");
    expect(turnLabel(run("ready"))).toBe("listening");
  });

  it("says they are speaking while they speak, and hands the turn back after", () => {
    expect(turnLabel(run("ready", "they-start"))).toBe("theirs");
    expect(turnLabel(run("ready", "they-start", "they-stop"))).toBe("listening");
  });

  it("says our words are going out while a reply is in flight", () => {
    expect(turnLabel(run("ready", "reply-start"))).toBe("yours");
    expect(turnLabel(run("ready", "reply-start", "reply-end"))).toBe("listening");
  });

  // Spec 2.1: if both are live the truthful thing to show is that they are
  // talking — the barge-in flush is about to cut our audio anyway.
  it("gives the hearing party precedence when both are live", () => {
    expect(turnLabel(run("ready", "reply-start", "they-start"))).toBe("theirs");
    expect(turnLabel(run("ready", "they-start", "reply-start"))).toBe("theirs");
  });

  it("returns to our reply if they stop before the reply finishes", () => {
    expect(turnLabel(run("ready", "reply-start", "they-start", "they-stop"))).toBe("yours");
  });

  it("drops everything on close so a dead call never shows a live turn", () => {
    expect(turnLabel(run("ready", "they-start", "closed"))).toBe("connecting");
  });

  it("ignores speech events that arrive before ready", () => {
    expect(turnLabel(run("they-start"))).toBe("connecting");
  });
});
