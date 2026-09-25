# Kinetic Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a deaf user the continuous, measured information a hearing person gets from sound — the other party's real voice amplitude, their own words inking as they are actually spoken, and an interruption they watch happen instead of read about.

**Architecture:** The capture worklet already holds the hearing party's raw float samples and throws them away; it gains an RMS value posted alongside the PCM, buffered in a ref and drawn to a canvas at 60fps. `transcript.agent.delta` delivers a complete word→time map in one burst before the audio plays, so word inking is driven by a playback clock on `ReplyPlayer` against a table we already hold. The interruption remainder moves out of a broken React updater and into the pure `ledgerReducer`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind v4 (`@theme` tokens), Vitest + jsdom + @testing-library/react, Web Audio API (AudioWorklet, AudioContext), Canvas 2D.

**Spec:** [`docs/superpowers/specs/2026-09-25-kinetic-captions-design.md`](../specs/2026-09-25-kinetic-captions-design.md)

**Measured evidence:** [`docs/research/gate-results-2026-09-22.md`](../../research/gate-results-2026-09-22.md), section "`transcript.agent.delta` — measured 2026-09-25".

## Global Constraints

- **Every visual channel is bound to a physical measurement.** No pitch, no emotion, no sentiment. Spec §1.
- **The verbatim pass-through is untouched.** No task modifies `app/api/llm/v1/chat/completions/route.ts` or `lib/sentinel.ts`.
- **Never `new AudioContext({ sampleRate })`.** Firefox silently loses echo cancellation; Safari garbles. `grep -rn "sampleRate" app lib public` must only find the worklet's `processorOptions` and `ctx.sampleRate`.
- **`transcript.agent.delta` carries `delta`, not `text`; one word per event including its trailing space; NOT cumulative.** The opposite convention to `transcript.user.delta`, which IS cumulative and must be replaced.
- **Colour is never the only channel.** Every status keeps icon + word + form + colour. 45ch caption measure (`.measure`) is unchanged.
- **`prefers-reduced-motion` must disable travelling motion** everywhere it is added.
- **No new npm dependencies.** Canvas 2D and Web Audio only.
- **Tailwind v4 tokens only** — `text-ink`, `text-mute`, `text-exact`, `text-altered`, `text-cut`, `bg-surface`, `border-line`, etc. from `app/globals.css` `@theme`. No raw hex in components except where an existing component already passes hex to an SVG `stroke`.
- **Commit after every task.** Message body explains *why*, not *what*.
- Run `npm test` (must be all-green) and `npm run build` before each commit. `npm run lint` must report **no more than 2 errors**, both pre-existing in `lib/agent-config.test.ts`.

## Review Focus

Five conditions the spec implies that no obvious happy-path test would exercise. Each line's test is assigned to the task that owns the code.

1. **A reply whose deltas never arrive** (network drop between burst and audio) — the ink must render nothing rather than crash or claim the whole line was spoken. *Task 3.*
2. **Deltas arriving for a superseded reply** after a barge-in started a new one — a stale `reply_id` must not ink the new row. *Task 3.*
3. **`getContext("2d")` returning null** — jsdom does this, and so does a browser under memory pressure or with canvas blocked. The trace must degrade silently, not throw during render. *Task 2.*
4. **An interruption whose spoken prefix does not match the typed line** (TTS normalised a number) — `remainderOf` falls back to the whole line, and the composer must not be handed a duplicate of something already spoken without the row saying so. *Task 5.*
5. **A second interruption while a remainder is already sitting unsent in the composer** — the second remainder must not clobber the first. *Task 5.*

---

### Task 1: Measured level out of the worklet

**Files:**
- Modify: `public/pcm-processor.js`
- Modify: `lib/audio/capture.ts:28-31`
- Create: `lib/audio/level-trace.ts`
- Test: `lib/audio/level-trace.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class LevelTrace { constructor(capacity: number); push(level: number): void; read(): Float32Array; clear(): void; get capacity(): number }` and `MicCapture.start(onChunk: (base64: string) => void, onLevel?: (level: number) => void)`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/audio/level-trace.test.ts
import { describe, expect, it } from "vitest";
import { LevelTrace } from "./level-trace";

describe("LevelTrace", () => {
  it("reads back oldest-to-newest, zero-filled before it wraps", () => {
    const trace = new LevelTrace(4);
    trace.push(0.1);
    trace.push(0.2);
    expect(Array.from(trace.read())).toEqual([0, 0, 0.1, 0.2]);
  });

  it("keeps only the newest `capacity` values once it wraps", () => {
    const trace = new LevelTrace(3);
    for (const v of [1, 2, 3, 4, 5]) trace.push(v);
    expect(Array.from(trace.read())).toEqual([3, 4, 5]);
  });

  it("clears back to silence so a new call does not inherit the last one's trace", () => {
    const trace = new LevelTrace(3);
    trace.push(0.9);
    trace.clear();
    expect(Array.from(trace.read())).toEqual([0, 0, 0]);
  });

  it("clamps to the 0..1 range a level meter can render", () => {
    const trace = new LevelTrace(2);
    trace.push(-0.5);
    trace.push(3);
    expect(Array.from(trace.read())).toEqual([0, 1]);
  });

  it("treats a non-finite level as silence rather than poisoning the buffer", () => {
    const trace = new LevelTrace(2);
    trace.push(Number.NaN);
    trace.push(Number.POSITIVE_INFINITY);
    expect(Array.from(trace.read())).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/audio/level-trace.test.ts`
Expected: FAIL — `Failed to resolve import "./level-trace"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/audio/level-trace.ts
/**
 * A fixed-size ring of recent loudness values.
 *
 * The worklet posts one value per render quantum — roughly 375 a second at
 * 48 kHz. That can never reach React state; at that rate a re-render per value
 * would spend the whole frame budget on reconciliation. So values land here, in
 * a plain object held in a ref, and the canvas reads the whole buffer once per
 * animation frame instead.
 *
 * Unwritten slots read as silence, so a call that has just started draws a flat
 * line rather than whatever the array was allocated over.
 */
export class LevelTrace {
  private readonly buffer: Float32Array;
  private writes = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`LevelTrace capacity must be a positive integer, got ${capacity}`);
    }
    this.buffer = new Float32Array(capacity);
  }

  get capacity(): number {
    return this.buffer.length;
  }

  /** NaN and Infinity are treated as silence: one bad frame must not put an
   * unrenderable value into a buffer the canvas reads every frame thereafter. */
  push(level: number): void {
    const safe = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    this.buffer[this.writes % this.buffer.length] = safe;
    this.writes += 1;
  }

  /**
   * Oldest to newest, always `capacity` long.
   *
   * Right-aligned before the buffer has wrapped: the newest value belongs at
   * the right edge from the very first frame, so the trace grows in from the
   * left instead of sliding sideways as the buffer fills.
   */
  read(): Float32Array {
    const { length } = this.buffer;
    const out = new Float32Array(length);
    if (this.writes < length) {
      out.set(this.buffer.subarray(0, this.writes), length - this.writes);
      return out;
    }
    const start = this.writes % length;
    out.set(this.buffer.subarray(start), 0);
    out.set(this.buffer.subarray(0, start), length - start);
    return out;
  }

  clear(): void {
    this.buffer.fill(0);
    this.writes = 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/audio/level-trace.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add RMS to the worklet**

In `public/pcm-processor.js`, inside `process(inputs)`, after the `input` guard and before the resample loop, compute RMS over the **input** samples (more of them than the resampled output, and they are the true signal):

```js
    // Root-mean-square of this render quantum: the hearing party's actual
    // loudness, measured rather than inferred. This is the only continuous
    // signal on the screen that is not delayed by transcription.
    let sumSquares = 0;
    for (let i = 0; i < input.length; i += 1) sumSquares += input[i] * input[i];
    const level = Math.sqrt(sumSquares / input.length);
```

Then replace the `postMessage` call:

```js
    // The PCM buffer is transferred (zero-copy); `level` is a plain number and
    // rides along in the same message so the two never drift apart.
    this.port.postMessage({ pcm: pcm16.buffer, level }, [pcm16.buffer]);
```

- [ ] **Step 6: Update the capture consumer**

In `lib/audio/capture.ts`, change the signature and the message handler:

```ts
  async start(
    onChunk: (base64: string) => void,
    onLevel?: (level: number) => void,
  ): Promise<void> {
```

```ts
      this.node.port.onmessage = (
        event: MessageEvent<{ pcm: ArrayBuffer; level: number }>,
      ) => {
        onChunk(encodeInt16ToBase64(new Int16Array(event.data.pcm)));
        onLevel?.(event.data.level);
      };
```

- [ ] **Step 7: Verify nothing else reads the old message shape**

Run: `grep -rn "port.onmessage\|event.data" lib app public`
Expected: the only hit for the worklet's port is the one just edited in `capture.ts`.

- [ ] **Step 8: Full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 9: Commit**

```bash
git add public/pcm-processor.js lib/audio/capture.ts lib/audio/level-trace.ts lib/audio/level-trace.test.ts
git commit -m "feat: measure the hearing party's loudness in the capture worklet

The worklet already had their raw float samples and threw everything away
but the resampled bytes. RMS per render quantum costs one loop over data
already in registers, and it is the only continuous signal available to a
deaf user that transcription does not delay by about a second.

LevelTrace buffers it outside React: ~375 values a second cannot drive
state, so the canvas reads a ring buffer once per animation frame instead.
Unwritten slots read as silence and right-align, so a call that just
started draws a flat line growing in from the left rather than sliding."
```

---

### Task 2: The voice trace canvas

**Files:**
- Create: `app/components/VoiceTrace.tsx`
- Test: `app/components/VoiceTrace.test.tsx`

**Interfaces:**
- Consumes: `LevelTrace` from Task 1.
- Produces: `<VoiceTrace trace={LevelTrace} live={boolean} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/VoiceTrace.test.tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceTrace } from "./VoiceTrace";
import { LevelTrace } from "@/lib/audio/level-trace";

describe("VoiceTrace", () => {
  it("is hidden from assistive technology — the turn label carries the text", () => {
    const { container } = render(<VoiceTrace trace={new LevelTrace(8)} live />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders without throwing when the 2d context is unavailable", () => {
    // jsdom returns null here, and so does a real browser with canvas blocked
    // or under memory pressure. A missing context must cost the trace, never
    // the call.
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    expect(() => render(<VoiceTrace trace={new LevelTrace(8)} live />)).not.toThrow();
    spy.mockRestore();
  });

  it("stops requesting frames once the call is no longer live", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { rerender } = render(<VoiceTrace trace={new LevelTrace(8)} live />);
    rerender(<VoiceTrace trace={new LevelTrace(8)} live={false} />);
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/VoiceTrace.test.tsx`
Expected: FAIL — cannot resolve `./VoiceTrace`.

- [ ] **Step 3: Write the implementation**

```tsx
// app/components/VoiceTrace.tsx
"use client";
import { useEffect, useRef } from "react";
import type { LevelTrace } from "@/lib/audio/level-trace";

/**
 * The hearing party's actual voice, drawn from measured amplitude.
 *
 * Why this exists at all: a hearing person knows someone is talking because
 * they can hear it. A deaf user's only equivalent was text that arrives about a
 * second late, in lumps. Amplitude is instant, so this moves before the caption
 * exists — it is the fastest signal on the screen, not decoration.
 *
 * It moves ONLY when there is real sound. app/globals.css argues that stillness
 * is what makes motion readable ("If everything pulsed, nothing would"), and
 * that survives here: silence renders flat, so stillness keeps its meaning and
 * becomes the absence of a measured thing rather than the absence of an
 * animation.
 *
 * Nothing here drives React state. The worklet posts ~375 values a second; this
 * reads the whole ring buffer once per animation frame and paints it.
 *
 * aria-hidden because it is a picture of a number. The turn label beside it
 * carries the same situation in words, unchanged, for screen-reader users —
 * a deaf user may also be one.
 */
export function VoiceTrace({ trace, live }: { trace: LevelTrace; live: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !live) return;

    // Null in jsdom, and in a real browser with canvas blocked or under memory
    // pressure. Losing the trace is acceptable; throwing during a call is not.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const values = trace.read();
      const mid = height / 2;
      // Read the ink colour from the cascade so the trace follows the theme
      // tokens in globals.css instead of hard-coding one of them.
      ctx.fillStyle = getComputedStyle(canvas).color;

      if (reduced) {
        // No travelling motion: one bar for the current level only. Still
        // honest, still live, nothing slides.
        const level = values[values.length - 1] ?? 0;
        const barHeight = Math.max(1, level * height);
        ctx.fillRect(0, mid - barHeight / 2, width, barHeight);
      } else {
        const count = values.length;
        const step = width / count;
        const barWidth = Math.max(1, step * 0.6);
        for (let i = 0; i < count; i += 1) {
          // sqrt opens up the quiet end: ordinary speech sits low in a linear
          // RMS scale and would otherwise read as near-silence.
          const level = Math.sqrt(values[i]);
          const barHeight = Math.max(1, level * height);
          ctx.fillRect(i * step, mid - barHeight / 2, barWidth, barHeight);
        }
      }

      frame.current = window.requestAnimationFrame(draw);
    };

    frame.current = window.requestAnimationFrame(draw);
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [trace, live]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="h-8 w-full text-cut"
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/components/VoiceTrace.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Full suite and build**

Run: `npm test && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add app/components/VoiceTrace.tsx app/components/VoiceTrace.test.tsx
git commit -m "feat: draw the hearing party's measured voice

Amplitude is instant where transcription lags about a second, so this
moves before the caption it belongs to exists. That makes it the fastest
signal on the screen rather than decoration.

Silence renders flat, which keeps globals.css's argument intact: stillness
is what makes the other motion readable, and here stillness is now the
absence of a measured thing rather than the absence of an animation.

Reduced motion drops the travel and keeps the level. A null 2d context
costs the trace and never the call."
```

---

### Task 3: The word timeline

**Files:**
- Create: `lib/caption-timeline.ts`
- Test: `lib/caption-timeline.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface TimedWord { text: string; startMs: number; endMs: number }`
  - `interface ReplyTimeline { replyId: string; words: TimedWord[] }`
  - `function appendWord(timeline: ReplyTimeline | null, replyId: string, delta: string, startMs: number, endMs: number): ReplyTimeline`
  - `function inkSplit(timeline: ReplyTimeline | null, elapsedMs: number | null): { spoken: string; unspoken: string }`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/caption-timeline.test.ts`
Expected: FAIL — cannot resolve `./caption-timeline`.

- [ ] **Step 3: Write the implementation**

```ts
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
 * Split the reply into what the voice has already said and what it has not.
 *
 * A word counts as spoken once it has STARTED. Waiting for `endMs` would leave
 * the word currently being said rendered as unspoken, which reads as the ink
 * lagging the voice.
 *
 * `expectedReplyId`, when given, guards against a late burst for a superseded
 * reply inking the current one.
 */
export function inkSplit(
  timeline: ReplyTimeline | null,
  elapsedMs: number | null,
  expectedReplyId?: string,
): { spoken: string; unspoken: string } {
  if (!timeline || timeline.words.length === 0) return { spoken: "", unspoken: "" };
  if (expectedReplyId !== undefined && timeline.replyId !== expectedReplyId) {
    return { spoken: "", unspoken: "" };
  }
  if (elapsedMs === null) {
    return { spoken: "", unspoken: timeline.words.map((w) => w.text).join("") };
  }

  let spoken = "";
  let unspoken = "";
  for (const word of timeline.words) {
    if (word.startMs <= elapsedMs) spoken += word.text;
    else unspoken += word.text;
  }
  return { spoken, unspoken };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/caption-timeline.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Full suite and build**

Run: `npm test && npm run build`

- [ ] **Step 6: Commit**

```bash
git add lib/caption-timeline.ts lib/caption-timeline.test.ts
git commit -m "feat: the word timeline a reply is inked against

transcript.agent.delta delivers the whole map in one burst before the
audio plays (measured 2026-09-25), so this is a lookup table, not a
stream. Nothing here depends on delta arrival timing; the playback clock
drives the ink.

A word counts as spoken once it has STARTED, not ended -- waiting for
end_ms leaves the word currently being said rendered as unspoken, which
reads as the ink lagging the voice.

A delta for a different reply_id starts a fresh timeline, so a late burst
for a reply that was barged over cannot ink the row that replaced it."
```

---

### Task 4: The playback clock and the delta wire

**Files:**
- Modify: `lib/audio/playback.ts`
- Modify: `lib/relay-client.ts:5-13` (handlers) and the `handle` switch
- Test: `lib/audio/playback.test.ts`, `lib/relay-client.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–3 at runtime.
- Produces: `ReplyPlayer.elapsedMs(): number | null`, and a new handler `onSpokenWord(replyId: string, delta: string, startMs: number, endMs: number): void` on `RelayHandlers`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/audio/playback.test.ts`:

```ts
describe("ReplyPlayer playback clock", () => {
  it("has no clock before anything is scheduled", () => {
    const { ctx } = fakeContext();
    expect(new ReplyPlayer(ctx).elapsedMs()).toBeNull();
  });

  it("reads zero until the scheduled lead-in has actually elapsed", () => {
    // The first buffer starts MIN_LEAD_SECONDS in the future. Until the clock
    // reaches it, no audio has been heard and nothing may be inked.
    const { ctx } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    expect(player.elapsedMs()).toBe(0);
  });

  it("measures from the moment the reply's audio began, not from enqueue", () => {
    const { ctx } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = MIN_LEAD_SECONDS + 0.5;
    expect(player.elapsedMs()).toBeCloseTo(500, 3);
  });

  it("drops the clock on flush so a barged reply cannot keep inking", () => {
    const { ctx } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = MIN_LEAD_SECONDS + 0.5;
    player.flush();
    expect(player.elapsedMs()).toBeNull();
  });

  it("starts a new clock for the reply after a flush", () => {
    const { ctx } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    player.flush();
    ctx.currentTime = 5;
    player.enqueue(chunk(24_000));
    ctx.currentTime = 5 + MIN_LEAD_SECONDS + 0.25;
    expect(player.elapsedMs()).toBeCloseTo(250, 3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/audio/playback.test.ts`
Expected: FAIL — `player.elapsedMs is not a function`.

- [ ] **Step 3: Implement the clock**

In `lib/audio/playback.ts`, add a field beside `cursor`:

```ts
  private cursor = 0;
  /** When this reply's first frame is scheduled to be heard, on the context
   * clock. Null between replies. */
  private replyStart: number | null = null;
```

In `enqueue`, immediately after the `this.cursor = Math.max(...)` line and before `source.start(this.cursor)`:

```ts
    // The first frame of a reply defines its timeline origin. transcript.agent
    // .delta's start_ms values are offsets into this same audio, so the two
    // share an origin and the ~296ms of leading silence needs no correction:
    // nothing inks until the voice actually starts, which is correct.
    if (this.replyStart === null) this.replyStart = this.cursor;
```

Add the accessor after `leadIn()`:

```ts
  /**
   * Milliseconds of this reply's audio the listener has actually heard, or null
   * when no reply is playing.
   *
   * Clamped at zero: the first frame is scheduled a lead-in into the future, and
   * a negative elapsed would ink words before any sound left the speaker.
   */
  elapsedMs(): number | null {
    if (this.replyStart === null) return null;
    return Math.max(0, (this.ctx.currentTime - this.replyStart) * 1000);
  }
```

In `flush()`, after `this.cursor = this.ctx.currentTime;`:

```ts
    // A barged reply must stop inking. The next enqueue opens a new timeline.
    this.replyStart = null;
```

- [ ] **Step 4: Run to verify the clock tests pass**

Run: `npx vitest run lib/audio/playback.test.ts`
Expected: PASS, including the 5 new tests and all pre-existing ones.

- [ ] **Step 5: Write the failing relay-client test**

Append to `lib/relay-client.test.ts`, following the harness already in that file for feeding server messages (reuse whatever helper the existing tests use to deliver a message; if the existing tests construct the client with a fake socket, do the same):

```ts
it("forwards word-level agent deltas with their timings", () => {
  // Measured shape 2026-09-25: field is `delta` (NOT `text`), one word per
  // event including its trailing space, with start_ms/end_ms offsets into the
  // reply audio. Reading `text` here yields undefined.
  const words: Array<[string, string, number, number]> = [];
  const { deliver } = makeClient({
    onSpokenWord: (replyId, delta, startMs, endMs) =>
      words.push([replyId, delta, startMs, endMs]),
  });

  deliver({
    type: "transcript.agent.delta",
    reply_id: "resp_1",
    item_id: "msg_1",
    delta: "I ",
    start_ms: 296,
    end_ms: 312,
  });

  expect(words).toEqual([["resp_1", "I ", 296, 312]]);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run lib/relay-client.test.ts`
Expected: FAIL — `onSpokenWord` never called.

- [ ] **Step 7: Wire the event**

In `lib/relay-client.ts`, add to `RelayHandlers`:

```ts
  /** One word of the reply currently being spoken, with its offsets into that
   * reply's audio. The field is `delta`, not `text`, and these are NOT
   * cumulative — the opposite convention to transcript.user.delta. */
  onSpokenWord(replyId: string, delta: string, startMs: number, endMs: number): void;
```

Add a case to the `handle` switch, directly above `case "transcript.agent":`:

```ts
      case "transcript.agent.delta":
        this.handlers.onSpokenWord(
          message.reply_id as string,
          message.delta as string,
          message.start_ms as number,
          message.end_ms as number,
        );
        break;
```

- [ ] **Step 8: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all green. Every existing construction of `RelayHandlers` in tests and in `app/page.tsx` must now supply `onSpokenWord`; add a no-op where a test does not care.

- [ ] **Step 9: Commit**

```bash
git add lib/audio/playback.ts lib/audio/playback.test.ts lib/relay-client.ts lib/relay-client.test.ts
git commit -m "feat: a playback clock, and the word deltas to ink against it

The ink has to be driven by what the listener has actually heard, not by
when deltas arrived -- they arrive in one burst before the audio plays, so
inking on arrival would claim words were spoken before they left. On a
relay that is the one lie we do not get to tell.

elapsedMs measures from the scheduled start of the reply's first frame,
which shares an origin with start_ms, so the ~296ms of leading silence
needs no correction. It clamps at zero (the first frame is a lead-in into
the future) and drops to null on flush, so a barged reply stops inking."
```

---

### Task 5: The remainder, out of the broken updater

**Files:**
- Modify: `lib/ledger.ts` (`Utterance`, `ledgerReducer`)
- Modify: `app/page.tsx:106-121` (delete the broken block)
- Modify: `app/components/Composer.tsx` (accept an externally-supplied notice)
- Test: `lib/ledger.test.ts`, `app/components/Composer.test.tsx`

**Interfaces:**
- Consumes: `remainderOf` (already in `lib/ledger.ts`).
- Produces: `Utterance.remainder: string | null`; `Composer` gains prop `continuation: string | null` and `onContinuationUsed: () => void`.

- [ ] **Step 1: Write the failing ledger test**

```ts
// append to lib/ledger.test.ts
describe("ledgerReducer — the interrupted remainder", () => {
  it("records what never left the user's side, so nothing has to be retyped", () => {
    let state = ledgerReducer([], {
      type: "typed",
      id: "u1",
      seq: 1,
      text: "I'd like to book an appointment for next Tuesday",
    });
    state = ledgerReducer(state, {
      type: "spoken",
      text: "I'd like to book an appointment",
      interrupted: true,
    });
    expect(state[0].status).toBe("interrupted");
    expect(state[0].remainder).toBe("for next Tuesday");
  });

  it("leaves no remainder when the line completed", () => {
    let state = ledgerReducer([], { type: "typed", id: "u1", seq: 1, text: "Yes." });
    state = ledgerReducer(state, { type: "spoken", text: "Yes.", interrupted: false });
    expect(state[0].remainder).toBeNull();
  });

  it("leaves no remainder when the cut landed after the last word", () => {
    let state = ledgerReducer([], { type: "typed", id: "u1", seq: 1, text: "Please hold." });
    state = ledgerReducer(state, { type: "spoken", text: "Please hold.", interrupted: true });
    expect(state[0].remainder).toBeNull();
  });

  it("falls back to the whole line when the spoken prefix does not match", () => {
    // TTS normalisation can make the spoken text diverge from the typed text
    // (a phone number read back differently). remainderOf returns the whole
    // line rather than guess, and the row keeps the fragment it actually
    // spoke so the user can see the two do not line up.
    let state = ledgerReducer([], {
      type: "typed",
      id: "u1",
      seq: 1,
      text: "Call 415 555 0134 please",
    });
    state = ledgerReducer(state, {
      type: "spoken",
      text: "Call four one five",
      interrupted: true,
    });
    expect(state[0].remainder).toBe("Call 415 555 0134 please");
    expect(state[0].spokenText).toBe("Call four one five");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/ledger.test.ts`
Expected: FAIL — `remainder` is `undefined`.

- [ ] **Step 3: Implement in the reducer**

In `lib/ledger.ts`, add to the `Utterance` interface:

```ts
  /** What was typed but never spoken, when the hearing party cut the line off.
   * Null unless this row is `interrupted` with something actually left over.
   *
   * It lives on the row, computed in this pure reducer, because the previous
   * home for it -- a second setUtterances updater in app/page.tsx -- could
   * never work: push() queues the reducer, which flips this row from `pending`
   * to `interrupted`, and the updater after it searched for a row still
   * `pending`. It never found one, so the remainder was computed correctly by
   * remainderOf() and then dropped on the floor, every single time. */
  remainder: string | null;
```

In the `typed` branch of `ledgerReducer`, add `remainder: null,` beside `spokenText: null,`.

In the settle branch, replace the final assignment:

```ts
  const next = [...state];
  const remainder =
    status === "interrupted" ? remainderOf(utterance.typedText, event.text) || null : null;
  next[index] = { ...utterance, spokenText: event.text, status, remainder };
  return next;
```

`remainderOf` is declared below `ledgerReducer` in this file; function declarations hoist, so no reordering is needed.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/ledger.test.ts`
Expected: PASS. Fix any pre-existing test in this file that asserts a whole-object shape by adding `remainder: null`.

- [ ] **Step 5: Delete the broken block in page.tsx**

In `app/page.tsx`, replace the whole `onSpoken` handler body with:

```ts
            onSpoken: (text, interrupted) => {
              // The remainder is computed inside ledgerReducer now. It cannot
              // be done out here: this runs in the same tick as push(), and
              // whichever order the two updaters queue in, one of them reads
              // state the other has already changed.
              push({ type: "spoken", text, interrupted });
            },
```

Remove the now-unused `remainderOf` from the import at `app/page.tsx:14`.

- [ ] **Step 6: Write the failing Composer test**

```tsx
// append to app/components/Composer.test.tsx
describe("Composer — continuing a line that was cut off", () => {
  function setup(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
    const onChange = vi.fn();
    const onContinuationUsed = vi.fn();
    const utils = render(
      <Composer
        value=""
        onChange={onChange}
        onSend={vi.fn()}
        disabled={false}
        continuation={null}
        onContinuationUsed={onContinuationUsed}
        {...props}
      />,
    );
    return { ...utils, onChange, onContinuationUsed };
  }

  it("puts the unspoken tail in the box when the box is empty", () => {
    const { rerender, onChange } = setup();
    rerender(
      <Composer
        value=""
        onChange={onChange}
        onSend={vi.fn()}
        disabled={false}
        continuation="for next Tuesday"
        onContinuationUsed={vi.fn()}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("for next Tuesday");
  });

  it("says so, rather than text appearing in the box unexplained", () => {
    setup({ value: "for next Tuesday", continuation: "for next Tuesday" });
    expect(screen.getByText(/cut off/i)).toBeInTheDocument();
  });

  it("never clobbers something the user is already typing", () => {
    const { onChange } = setup({ value: "actually, never mind", continuation: "for next Tuesday" });
    expect(onChange).not.toHaveBeenCalledWith("for next Tuesday");
  });

  it("does not re-fill a second time once the user has cleared the box", () => {
    // A second interruption while the first remainder sits unsent must not
    // overwrite it, and an already-consumed remainder must not come back.
    const { rerender, onChange } = setup({ value: "", continuation: "first tail" });
    onChange.mockClear();
    rerender(
      <Composer
        value=""
        onChange={onChange}
        onSend={vi.fn()}
        disabled={false}
        continuation="first tail"
        onContinuationUsed={vi.fn()}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run app/components/Composer.test.tsx`
Expected: FAIL — unknown props.

- [ ] **Step 8: Implement in Composer**

Add the two props to the signature, then an effect that fills once per distinct continuation:

```tsx
  /** The last continuation actually written into the box. A remainder is
   * offered once: if the user clears the box, or a second interruption arrives
   * while the first tail is still sitting there unsent, nothing is overwritten. */
  const filled = useRef<string | null>(null);

  useEffect(() => {
    if (!continuation) return;
    if (filled.current === continuation) return;
    // Only into an empty box. Text appearing over something half-typed is the
    // same failure as a correction the user cannot see before it is spoken.
    if (value.trim() !== "") return;
    filled.current = continuation;
    onChange(continuation);
    setNotice(null);
    onContinuationUsed();
  }, [continuation, value, onChange, onContinuationUsed]);
```

Render the explanation in the existing notice paragraph, before the correction notice:

```tsx
        {continuation && filled.current === continuation && value === continuation ? (
          <span>
            They cut you off. The rest of your line is here — press Enter to finish it.
          </span>
        ) : null}
```

- [ ] **Step 9: Run tests and build**

Run: `npm test && npm run build`
Expected: all green. `app/page.tsx` must now pass `continuation` and `onContinuationUsed` to `Composer`; derive `continuation` as the `remainder` of the most recent `interrupted` utterance, and clear it in `onContinuationUsed`.

- [ ] **Step 10: Commit**

```bash
git add lib/ledger.ts lib/ledger.test.ts app/page.tsx app/components/Composer.tsx app/components/Composer.test.tsx
git commit -m "fix: the unspoken remainder was computed and then dropped

page.tsx called push() -- queueing the ledger reducer, which flips the row
from pending to interrupted -- and then queued a second updater looking for
a row still pending. It never found one, so setDraft never ran and
remainderOf(), correct and unit-tested, was unreachable. Every cut-off line
had to be retyped in full.

The remainder now lives on the row, computed in the pure reducer where
there is no ordering hazard and it can be tested without React. The
composer offers it once, only into an empty box, and says why the text is
there -- a fill the user cannot see coming is the same failure as a
correction they cannot see before it is spoken."
```

---

### Task 6: Inking, ghosting, and density in the timeline

**Files:**
- Modify: `app/components/Timeline.tsx`
- Test: `app/components/Timeline.test.tsx`

**Interfaces:**
- Consumes: `Utterance.remainder` (Task 5), `inkSplit` (Task 3).
- Produces: `<Timeline heard utterances partial ink />` where `ink: { id: string; spoken: string; unspoken: string } | null` identifies the row currently being spoken.

- [ ] **Step 1: Write the failing test**

```tsx
// append to app/components/Timeline.test.tsx
describe("Timeline — what was actually said", () => {
  it("shows the unspoken tail of a cut-off line instead of only saying 'interrupted'", () => {
    render(
      <Timeline
        heard={[]}
        utterances={[
          u({
            status: "interrupted",
            typedText: "I'd like to book an appointment for next Tuesday",
            spokenText: "I'd like to book an appointment",
            remainder: "for next Tuesday",
          }),
        ]}
        partial=""
        ink={null}
      />,
    );
    expect(screen.getByText(/for next Tuesday/)).toBeInTheDocument();
  });

  it("keeps a matched line quiet — no card, no chip, just the mark", () => {
    const { container } = render(
      <Timeline heard={[]} utterances={[u({ status: "match" })]} partial="" ink={null} />,
    );
    expect(screen.queryByText(/spoken exactly/i)).toBeNull();
    expect(container.querySelector("[data-receipt='match']")).not.toBeNull();
  });

  it("keeps a mismatch loud — it is the one state that must be read", () => {
    render(
      <Timeline
        heard={[]}
        utterances={[u({ status: "mismatch", typedText: "Yes.", spokenText: "No." })]}
        partial=""
        ink={null}
      />,
    );
    expect(screen.getByText(/altered/i)).toBeInTheDocument();
    expect(screen.getByText("No.")).toBeInTheDocument();
  });

  it("inks the words already spoken and leaves the rest ghosted", () => {
    render(
      <Timeline
        heard={[]}
        utterances={[u({ id: "u1", status: "pending", typedText: "I would like to reschedule" })]}
        partial=""
        ink={{ id: "u1", spoken: "I would ", unspoken: "like to reschedule" }}
      />,
    );
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("I would", { exact: false })).toBeInTheDocument();
    expect(row.querySelector("[data-ink='unspoken']")?.textContent).toContain("like to reschedule");
  });
});
```

Add `remainder: null` to the `u()` factory's defaults at the top of this file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/Timeline.test.tsx`
Expected: FAIL — unknown prop `ink`, missing `data-receipt`.

- [ ] **Step 3: Implement**

Rework `Said` in `app/components/Timeline.tsx`:

- Accept `ink: { spoken: string; unspoken: string } | null`.
- When `ink` is present and the row is `pending`, render the typed text as two spans: the spoken part in `text-ink`, and the rest in `text-mute` with `data-ink="unspoken"`.
- `match`: no card, no chip. A `border-l-2 border-exact pl-4` rule, the text, and a small `Icon` with `data-receipt="match"` and a visually-hidden "spoken exactly" for screen readers (`sr-only`), so the word channel survives for assistive tech while the visual channel quietens.
- `mismatch`: unchanged loud filled treatment.
- `interrupted`: `border-l-2 border-cut pl-4`, the spoken part solid, then the `remainder` in `text-mute` with a `Cut off — not spoken:` label. Render the remainder only when it is non-null.
- Keep every status's `Icon`, and keep the `RECEIPT` word available to assistive technology in all four states.
- Constrain the list to the reading measure: put `measure` on the `<ol>` so the card edge and the scrollbar relate to the text rather than floating at the container edge.

Pass `ink` through `Timeline`'s props to the matching row by `id`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/components/Timeline.test.tsx`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 5: Confirm the accessibility channels survive**

Run: `npx vitest run app/components/Timeline.test.tsx -t "redundant"` if such a test exists; otherwise confirm by reading that every status still renders an `Icon`, a word (visible or `sr-only`), and a distinct form.

- [ ] **Step 6: Full suite and build**

Run: `npm test && npm run build`

- [ ] **Step 7: Commit**

```bash
git add app/components/Timeline.tsx app/components/Timeline.test.tsx
git commit -m "feat: ink the spoken words, ghost the ones that never left

An interruption was a label. Now it is the thing itself: the words that
made it out stay solid, the ones that did not stay ghosted on the row, and
the tail is visible instead of described.

Density follows from the same edit. A matched line was a bordered card
carrying a labelled chip -- the most common outcome wearing the most ink,
so a good call built a wall of identical green boxes. It keeps a rule and
a mark, with the word still there for assistive tech. Mismatch stays loud,
because it is the one state that has to be read.

The list is constrained to the reading measure so the card edge and the
scrollbar relate to the words instead of floating ~290px out, which is
what made the screen feel boxed in."
```

---

### Task 7: Wire it into the call

**Files:**
- Modify: `app/page.tsx`
- Test: none new — this is composition of tested units; the browser matrix re-run in Task 8 is its test.

**Interfaces:**
- Consumes: everything from Tasks 1–6.

- [ ] **Step 1: Hold the trace and the timeline in refs**

In `Page()`:

```ts
  // Neither of these may be React state: the worklet posts ~375 levels a
  // second, and the delta burst lands ~18 words inside 4ms. Both are read by
  // the render loop, not by reconciliation.
  const trace = useRef(new LevelTrace(160));
  const timeline = useRef<ReplyTimeline | null>(null);
```

- [ ] **Step 2: Feed the trace from the mic**

Where `capture.current.start(...)` is called, pass the level callback as its second argument:

```ts
      await capture.current.start(
        (base64) => client.current?.sendAudio(base64),
        (level) => trace.current.push(level),
      );
```

- [ ] **Step 3: Collect deltas**

Add to the handlers object passed to `RelayClient`:

```ts
            onSpokenWord: (replyId, delta, startMs, endMs) => {
              timeline.current = appendWord(timeline.current, replyId, delta, startMs, endMs);
            },
```

- [ ] **Step 4: Drive the ink from the playback clock**

Add a `useState` for the ink and an effect that samples the clock on each animation frame while a reply is in flight:

```ts
  const [ink, setInk] = useState<{ id: string; spoken: string; unspoken: string } | null>(null);

  useEffect(() => {
    if (!live) return;
    let frame = 0;
    const tick = () => {
      const player = playerRef.current;
      const pending = utterances.find((u) => u.status === "pending");
      const elapsed = player?.elapsedMs() ?? null;
      if (!pending || elapsed === null) {
        setInk((prev) => (prev === null ? prev : null));
      } else {
        const split = inkSplit(timeline.current, elapsed);
        setInk((prev) =>
          prev && prev.id === pending.id && prev.spoken === split.spoken
            ? prev
            : { id: pending.id, ...split },
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live, utterances]);
```

The `setInk` identity guards matter: without them this sets state 60 times a second and re-renders the whole timeline every frame. Reference the existing `ReplyPlayer` instance — if `page.tsx` does not already hold one in a ref, add `playerRef` where the player is constructed.

- [ ] **Step 5: Render the trace beside the turn indicator**

In the live block, replace the turn-bar `<div>` contents so the trace sits under the label without adding height:

```tsx
          <div className="flex flex-col gap-1 border-b border-line pb-3">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
              <TurnIndicator label={turnLabel(turn, awaitingReceipt(utterances))} />
              <p className="text-sm tabular-nums text-dim">
                {total === 0 ? "Nothing spoken yet" : `${matched} of ${total} spoken exactly`}
              </p>
            </div>
            <VoiceTrace trace={trace.current} live={live} />
          </div>
```

- [ ] **Step 6: Pass ink and continuation through**

`<Timeline … ink={ink} />`, and `<Composer … continuation={continuation} onContinuationUsed={…} />` where `continuation` is the `remainder` of the most recent `interrupted` utterance.

- [ ] **Step 7: Move hang-up into the header**

Render the hang-up control inside `<header>` when `live`, as a compact text button keeping `border-danger`/`text-danger` and the full label `Hang up and delete the recording`. Delete the standalone button from the bottom of the live block. This is the ~44px plus a 20px gap the transcript gets back.

- [ ] **Step 8: Reset per call**

In the function that resets state at the start of a call (where `setUtterances([])` already runs), add:

```ts
    trace.current.clear();
    timeline.current = null;
    setInk(null);
```

- [ ] **Step 9: Verify the sample-rate guard still holds**

Run: `grep -rn "sampleRate" app lib public`
Expected: only the worklet's `processorOptions` and `ctx.sampleRate`. **Any other hit is the Firefox echo-cancellation bug.**

- [ ] **Step 10: Full suite, build, lint**

Run: `npm test && npm run build && npm run lint`
Expected: tests green; build succeeds; lint reports at most the 2 pre-existing errors in `lib/agent-config.test.ts`.

- [ ] **Step 11: Commit**

```bash
git add app/page.tsx
git commit -m "feat: put the measured voice and the moving ink on the call

The trace sits under the turn label rather than replacing it: the trace
shows sound, the label shows whose turn it is, and during the user's own
reply the trace is quiet while the turn is still theirs. Two facts, both
needed, one element so the vertical budget does not grow.

Neither the levels nor the deltas touch React state -- ~375 levels a
second and an 18-word burst inside 4ms. Both live in refs and are sampled
once per animation frame, and setInk is identity-guarded so a frame that
changes nothing does not re-render the timeline.

Hang-up moves into the header, which is where the transcript gets its
vertical space back."
```

---

### Task 8: Ship it

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/TASKS.md`, `docs/BROWSER-NOTES.md`, `docs/research/hackathon-strategy.md`, `docs/superpowers/specs/2026-09-23-aloud-interface.md`

- [ ] **Step 1: Deploy**

Run: `npx vercel --prod`
Record the deployment URL.

- [ ] **Step 2: Re-run the validation gates against the new deployment**

Run: `node scripts/gate-probe.mjs https://aloud-implementation.vercel.app`
Then: `node scripts/gate-probe.mjs https://aloud-implementation.vercel.app --idle`
Expected: G2 silent, G3 latency reported, G4 all match. **If G4 regresses, stop and fix — the receipt is the product.** Record the numbers.

- [ ] **Step 3: Put a measured latency number in the README**

Take `time_to_first_audio_ms` from the gate-probe G3 output and write it into `README.md` with its date and method, and state that it includes `MIN_LEAD_SECONDS` (120 ms of deliberate scheduling lead), not just the ~29 ms custom-LLM hop. Do not round it into a rounder, better number.

- [ ] **Step 4: Credit Caption with Intention**

Add a short section to `README.md` naming [Caption with Intention](https://www.captionwithintention.org/) (Chicago Hearing Society) as the inspiration for the kinetic treatment, stating plainly that theirs is a **human-authored system for post-produced film** and Aloud drives the same visual grammar from live machine signal, and that Aloud deliberately implements **only** the channels it can measure — no pitch, no emotion.

- [ ] **Step 5: Reset the browser matrix**

Every row in `docs/BROWSER-NOTES.md` was measured against a build three commits stale and is now void. Reset all cells to `PENDING — re-test required after the 2026-09-25 kinetic-caption work`, keeping the Firefox first-call stutter note and its UNVERIFIED hypothesis intact.

- [ ] **Step 6: Final leaderboard re-scan**

Run the method in `docs/research/hackathon-strategy.md` §4.1: `curl -sL "https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live"`, unescape `\"`, regex the submission objects, and search all exposed titles and short descriptions for the accessibility term list. Append the result as §4.2 with today's date, the counts, and an honest note that only the top 50 are readable.

- [ ] **Step 7: Refresh the stale status docs**

- `CLAUDE.md` "Status / stack": Tasks 6–13 are no longer "the remaining work". State what is actually left (the demo video, and the browser re-test).
- `CLAUDE.md` gotchas: add the two-conventions rule (`transcript.agent.delta` is one word, appended; `transcript.user.delta` is cumulative, replaced) and the measured delta-burst behaviour.
- `docs/TASKS.md`: mark Day 7's browser matrix as reset and re-pending; add the kinetic-caption work as done.
- `docs/superpowers/specs/2026-09-23-aloud-interface.md`: §2.5's "hand the remainder back to the composer" now describes a mechanism that lives in `ledgerReducer`; correct the reference.

- [ ] **Step 8: Full verification**

Run: `npm test && npm run build && npm run lint`
Expected: all tests green, build succeeds, lint at most 2 pre-existing errors.

- [ ] **Step 9: Commit and push**

```bash
git add -A
git commit -m "docs: measured latency, the CWI credit, and an honest reset of the matrix

The browser matrix was measured against a build three commits stale and
every cell is void. Reset rather than carried forward -- a matrix that
describes code nobody is submitting is worse than an empty one.

Caption with Intention is credited as inspiration and explicitly not
claimed: theirs is a human-authored system for post-produced film, this
drives the same grammar from live signal and implements only the channels
it can measure."
git push origin master
```

---

## Notes for the executor

- **Do not touch** `app/api/llm/v1/chat/completions/route.ts`, `lib/sentinel.ts`, or `lib/agent-config.ts`. The verbatim pass-through and all five closed gates depend on them.
- **The greeting swallow in `relay-client.ts`** (`greetingConsumed`) exists for a measured reason. Leave it alone.
- If a task's tests cannot be made to pass without changing an interface another task declared, **stop and say so** rather than changing the interface silently.
- Every commit message explains why. This repo's history is part of the submission.
