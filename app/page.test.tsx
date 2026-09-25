import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayHandlers } from "@/lib/relay-client";

/**
 * The live screen, driven through its real handlers.
 *
 * Everything below the page is stubbed — the socket, the mic and the audio
 * clock — because what is under test is not any of them. It is the one thing
 * this product cannot get wrong: whether the row on screen is a true statement
 * about the words going out in the user's name, at every moment, including the
 * moments between one reply and the next.
 *
 * `vi.hoisted` because vi.mock factories are hoisted above every import; the
 * handles the tests steer have to exist by then.
 */
const stub = vi.hoisted(() => ({
  /** What ReplyPlayer.elapsedMs() returns. `null` is what a real flush() —
   * a barge-in — produces, and it is the state I2 is about. */
  elapsed: null as number | null,
  handlers: null as RelayHandlers | null,
  says: 0,
}));

vi.mock("@/lib/audio/playback", () => ({
  ReplyPlayer: class {
    enqueue() {}
    beginReply() {}
    flush() {}
    close() {}
    elapsedMs() {
      return stub.elapsed;
    }
  },
}));

vi.mock("@/lib/audio/capture", () => ({
  MicCapture: class {
    async start() {}
    stop() {}
  },
}));

vi.mock("@/lib/relay-client", () => ({
  connectWithRecovery: async (_fetch: unknown, handlers: RelayHandlers) => {
    stub.handlers = handlers;
    return {
      sessionId: null,
      sendAudio: () => {},
      hangUp: async () => {},
      say: () => `reply-${(stub.says += 1)}`,
    };
  },
}));

import Page from "./page";

/** A hand-driven animation frame queue: the ink is a rAF loop, and these tests
 * need to advance it one frame at a time rather than race a real one. cancel
 * really removes, so a torn-down effect's callback cannot fire from a stale
 * closure — exactly what the browser does. */
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;

async function frame() {
  const due = [...frames.entries()];
  frames.clear();
  await act(async () => {
    for (const [, cb] of due) cb(0);
  });
}

const box = () => screen.getByRole("textbox", { name: /type what you want said/i });
const pendingRow = () => document.querySelector("[data-receipt='pending']");
const unspoken = () => pendingRow()?.querySelector("[data-ink='unspoken']")?.textContent ?? null;
const said = () => pendingRow()?.querySelector("[data-ink='said']")?.textContent ?? null;
/** The one word the stroke is under, and whether it is still travelling. */
const saying = () => pendingRow()?.querySelector("[data-ink='saying']") as HTMLElement | null;

async function startCall() {
  await act(async () => {
    render(<Page />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /start the call/i }));
  });
}

async function send(text: string) {
  await act(async () => {
    fireEvent.change(box(), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(box(), { key: "Enter" });
  });
}

/** One word of a reply, as transcript.agent.delta delivers it: the field is
 * `delta`, one word, not cumulative, with offsets into this reply's audio. */
function word(replyId: string, delta: string, startMs: number, endMs: number) {
  stub.handlers!.onSpokenWord(replyId, delta, startMs, endMs);
}

/** reply.started — the API takes a turn. */
const replyStart = () => act(async () => stub.handlers!.onTurn("reply-start"));

/** The provider's record of what was actually said, which settles the row. */
const settle = (text: string, interrupted: boolean) =>
  act(async () => stub.handlers!.onSpoken(text, interrupted));

beforeEach(() => {
  stub.elapsed = null;
  stub.handlers = null;
  stub.says = 0;
  frames.clear();
  nextFrameId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    nextFrameId += 1;
    frames.set(nextFrameId, cb);
    return nextFrameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 0;
      async resume() {}
      async close() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the live screen — a pending row says only what is true of ITS line", () => {
  it("does not ink a new row with the previous reply's sentence", async () => {
    // C1. Between one reply ending and the next reply.started arriving
    // (238-377ms measured, and far longer if the previous reply is still
    // speaking) the playback clock still ran against the old origin and the
    // word table still held the old reply's words. A row created `pending` on
    // the keystroke therefore rendered the PREVIOUS line's text, in the solid
    // already-spoken ink, as a statement about what was being said right then.
    await startCall();

    await send("Hello, this is the first line");
    await replyStart();
    word("r1", "Hello, ", 0, 100);
    word("r1", "this ", 100, 200);
    word("r1", "is ", 200, 300);
    word("r1", "the ", 300, 400);
    word("r1", "first ", 400, 500);
    word("r1", "line", 500, 600);
    stub.elapsed = 5000; // the whole line is out
    await frame();
    // Every word said, so there is no tail left and no stroke anywhere — the
    // three-way split renders only the solid run.
    expect(unspoken()).toBeNull();
    expect(saying()).toBeNull();
    expect(said()).toBe("Hello, this is the first line");

    // The first line settles; the clock and the table are untouched, which is
    // the point — nothing clears them on its own.
    await settle("Hello, this is the first line", false);

    // A second line, with its reply.started still a round trip away.
    await send("Second line");
    await frame();

    const row = pendingRow();
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Second line");
    expect(row?.textContent).not.toContain("Hello, this is the first line");
  });

  it("does not ink a new row while the previous reply is still speaking", async () => {
    // The worse variant of the same defect: type the next line before the
    // current one has finished. The old table is not merely stale, it is live.
    await startCall();

    await send("Hello, this is the first line");
    await replyStart();
    word("r1", "Hello, ", 0, 100);
    word("r1", "this ", 100, 200);
    stub.elapsed = 150;
    await frame();

    await send("Second line");
    await frame();

    const rows = [...document.querySelectorAll("[data-receipt='pending']")];
    const second = rows[rows.length - 1];
    expect(second?.textContent).toContain("Second line");
    expect(second?.querySelector("[data-ink]")).toBeNull();
  });

  it("freezes the ink where the voice stopped when the hearing party cuts in", async () => {
    // I2. flush() nulls the player's reply origin, so elapsedMs() goes null
    // mid-sentence — correct, and playback.test.ts locks it. The defect was
    // here: clearing `ink` sent Timeline to its fallback, which renders the
    // ENTIRE typed line in the solid already-spoken treatment. At the exact
    // moment the user was cut off, the screen claimed every word got out.
    await startCall();

    await send("I would like to reschedule");
    await replyStart();
    word("r1", "I ", 0, 100);
    word("r1", "would ", 100, 200);
    word("r1", "like ", 200, 300);
    word("r1", "to ", 300, 400);
    word("r1", "reschedule", 400, 500);
    stub.elapsed = 150;
    await frame();
    expect(unspoken()).toBe("like to reschedule");

    // Barge-in.
    stub.elapsed = null;
    await frame();
    await frame();
    expect(unspoken()).toBe("like to reschedule");

    // The freeze is an approximation and it does not outlive the row: once the
    // provider's record lands, remainderOf's definitive split takes over and
    // there is no pending row left to hold ink at all.
    await settle("I would", true);
    await frame();
    expect(pendingRow()).toBeNull();
  });

  it("keeps the frozen split when the next line is sent before the row settles", async () => {
    // The two guards meet here. Sending clears `timeline.current` (C1) and
    // used to null `ink` with it — but the cut-off row can still be pending
    // when the user types again, and dropping its ink sends it back to
    // Timeline's fallback: the whole line solid, claiming every word got out.
    // Ink is keyed by row id, so keeping it cannot reach the new row.
    await startCall();

    await send("I would like to reschedule");
    await replyStart();
    word("r1", "I ", 0, 100);
    word("r1", "would ", 100, 200);
    word("r1", "like ", 200, 300);
    word("r1", "to ", 300, 400);
    word("r1", "reschedule", 400, 500);
    stub.elapsed = 150;
    await frame();

    stub.elapsed = null;
    await frame();
    await send("sorry, go on");
    await frame();

    // The cut-off row is still the first pending one, and still frozen.
    expect(unspoken()).toBe("like to reschedule");
    // The new row carries no ink of its own.
    const rows = document.querySelectorAll("[data-receipt='pending']");
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector("[data-ink]")).toBeNull();
    expect(rows[1].textContent).toContain("sorry, go on");
  });

  it("still falls back to the plain typed line for a row that has never inked", async () => {
    // The other side of the freeze: with no clock and no ink yet, there is
    // nothing to hold, and the row must show the typed text rather than a
    // blank card. This is the ~365ms before the first delta burst.
    await startCall();
    await send("I would like to reschedule");
    await frame();

    expect(pendingRow()?.textContent).toContain("I would like to reschedule");
    expect(unspoken()).toBeNull();
    expect(saying()).toBeNull();
  });

  it("does not animate the ink when the reader asks for reduced motion", async () => {
    // I4. globals.css's reduced-motion block cannot reach this: the movement
    // is React re-rendering different text 60 times a second, not a CSS
    // transition. Settled rows are unaffected either way.
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await startCall();

    await send("I would like to reschedule");
    await replyStart();
    word("r1", "I ", 0, 100);
    word("r1", "would ", 100, 200);
    stub.elapsed = 150;
    await frame();

    expect(pendingRow()?.textContent).toContain("I would like to reschedule");
    expect(unspoken()).toBeNull();
    expect(saying()).toBeNull();
  });

  it("moves the stroke to the next word as the voice reaches it", async () => {
    // The feature itself: one word marked at a time, handed on by the playback
    // clock against the provider's own word timings.
    await startCall();
    await send("I would like to reschedule");
    await replyStart();
    word("r1", "I ", 0, 100);
    word("r1", "would ", 100, 200);
    word("r1", "like ", 200, 300);
    word("r1", "to ", 300, 400);
    word("r1", "reschedule", 400, 500);

    stub.elapsed = 50;
    await frame();
    expect(saying()?.textContent).toBe("I");
    expect(said()).toBeNull();

    stub.elapsed = 250;
    await frame();
    expect(saying()?.textContent).toBe("like");
    expect(said()).toBe("I would ");
    expect(unspoken()).toBe("to reschedule");
  });

  it("gives the stroke this word's own duration, starting where the voice already is", async () => {
    // A long word is underlined slowly and a short one quickly, because the
    // stroke's length IS the word's measured length. The delay is negative so
    // it opens part-drawn instead of snapping back to the start of the word.
    await startCall();
    await send("I would like to reschedule");
    await replyStart();
    word("r1", "I ", 0, 100);
    word("r1", "would ", 100, 600);
    stub.elapsed = 300;
    await frame();

    const stroke = saying()!;
    expect(stroke.className).toContain("word-sweep-run");
    expect(stroke.style.getPropertyValue("--sweep-dur")).toBe("500ms");
    expect(stroke.style.getPropertyValue("--sweep-delay")).toBe("-200ms");
  });

  it("stops the stroke inside the word the voice was cut off on", async () => {
    // The stroke must not carry on across a word that was never finished. A
    // frozen row renders a static fraction, not a running animation — and the
    // fraction is where the clock had actually got to.
    await startCall();
    await send("I would like to reschedule");
    await replyStart();
    word("r1", "I ", 0, 100);
    word("r1", "would ", 100, 600);
    stub.elapsed = 350;
    await frame();

    stub.elapsed = null; // barge-in: flush() nulls the reply origin
    await frame();

    const stroke = saying()!;
    expect(stroke.textContent).toBe("would");
    expect(stroke.className).not.toContain("word-sweep-run");
    // 250ms into a 500ms word.
    expect(Number(stroke.style.getPropertyValue("--sweep-at"))).toBeCloseTo(0.5, 5);
  });
});
