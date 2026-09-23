# Aloud Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the untested Tasks 6–13 interface with a one-person relay console that shows whose turn it is, proves each line went out unaltered inline, lets an interrupted sentence be finished without retyping, and fixes the stacked-audio defect that garbles the first word.

**Architecture:** All new logic lands as pure functions in `lib/` with their own unit tests (`turn-state.ts`, `remainderOf` in `ledger.ts`, the lead-in in `playback.ts`), so none of it needs a socket or a browser to verify. The React layer is five small components over those functions, assembled by `app/page.tsx`. The two-column split and the standalone ledger list are deleted; one chronological timeline carries both sides with the verbatim receipt attached to each of the user's own lines.

**Tech Stack:** Next.js 15 App Router · TypeScript strict · Tailwind v4 (`@theme` tokens in `app/globals.css`) · Vitest + @testing-library/react · `next/font/google`.

**Spec:** [`docs/superpowers/specs/2026-09-23-aloud-interface.md`](../specs/2026-09-23-aloud-interface.md), which supplements [`2026-09-22-aloud-design.md`](../specs/2026-09-22-aloud-design.md) (architecture, pass-through, gates — unchanged by this plan).

## Global Constraints

Every task's requirements implicitly include all of these.

- **Never `new AudioContext({ sampleRate: 24000 })`.** Firefox silently loses echo cancellation; Safari garbles. `grep -rn "sampleRate" app lib public` must only find the worklet and `ctx.sampleRate`.
- **`reply.audio` carries audio in `data`**, not `audio`. `input.audio` uses `audio`.
- **`transcript.user.delta.text` is the full transcript so far** — replace, never concatenate.
- **Verbatim is built, not prompted.** Nothing in this plan may route typed text through a model. No task touches `app/api/llm/`.
- **The word is "deleted"** — a documented soft delete. Never "erased" or "destroyed".
- **No post-call artifact.** No transcript export, no download, no keepsake. Design spec §0.1.
- **No new dependencies.** Everything here uses what `package.json` already has.
- **Colour never carries meaning alone.** Every status ships an icon, a word, and a form as well.
- **Assistant-mode `mismatch` is never flagged amber** — it is a delegated paraphrase, not an alteration. Rule currently lives in `app/components/Ledger.tsx:11-24` and must survive the rewrite.
- `npm test`, `npm run lint` and `npm run build` must all pass at every commit. Lint has **10 known pre-existing errors** (8 in `.claude/` tooling, 2 in `lib/agent-config.test.ts`); do not "fix" those and do not add new ones.

---

### Task 1: Stop the first word stacking on itself

**Files:**
- Modify: `lib/audio/playback.ts:10-29`
- Test: `lib/audio/playback.test.ts` (3 existing assertions change, 3 new tests)

**Interfaces:**
- Consumes: nothing.
- Produces: `MIN_LEAD_SECONDS` exported from `lib/audio/playback.ts` (a `number`, `0.12`). No other task imports it; the tests do.

Measured basis (spec §3): frames arrive in 10 ms units at ~1× real time with as little as **0 ms** of margin, so scheduling at `ctx.currentTime` lands in the already-rendered past and several frames start in the same render quantum, summed.

- [ ] **Step 1: Update the three existing assertions that encode the old zero-lead behaviour**

In `lib/audio/playback.test.ts`, these three currently assert the bug. Replace them:

```ts
  it("schedules chunks back to back, not all at once", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    player.enqueue(chunk(24_000));
    expect(started[0]).toBeCloseTo(MIN_LEAD_SECONDS, 6);
    expect(started[1]).toBeCloseTo(MIN_LEAD_SECONDS + 1, 6);
  });

  it("never schedules in the past once the queue has drained", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = 10;
    player.enqueue(chunk(24_000));
    expect(started[1]).toBeCloseTo(10 + MIN_LEAD_SECONDS, 6);
  });

  it("resumes from now after a flush", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = 0.25;
    player.flush();
    player.enqueue(chunk(24_000));
    expect(started[1]).toBeCloseTo(0.25 + MIN_LEAD_SECONDS, 6);
  });
```

Add `MIN_LEAD_SECONDS` to the import on line 2:

```ts
import { MIN_LEAD_SECONDS, ReplyPlayer } from "./playback";
```

- [ ] **Step 2: Add the three new tests**

Append inside the `describe("ReplyPlayer", …)` block:

```ts
  it("never starts a frame at currentTime — that is the already-rendered past", () => {
    const { ctx, started } = fakeContext();
    ctx.currentTime = 3;
    new ReplyPlayer(ctx).enqueue(chunk(240)); // one 10 ms frame, as the server sends
    expect(started[0]).toBeGreaterThan(3);
  });

  it("does not re-add the lead mid-sentence — gaps stay exactly one buffer", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    for (let i = 0; i < 4; i += 1) player.enqueue(chunk(240)); // 4 x 10 ms
    expect(started[1] - started[0]).toBeCloseTo(0.01, 6);
    expect(started[2] - started[1]).toBeCloseTo(0.01, 6);
    expect(started[3] - started[2]).toBeCloseTo(0.01, 6);
  });

  it("uses twice the browser's reported output latency when that exceeds the floor", () => {
    const { ctx, started } = fakeContext();
    (ctx as unknown as { outputLatency: number }).outputLatency = 0.2; // Bluetooth-ish
    new ReplyPlayer(ctx).enqueue(chunk(240));
    expect(started[0]).toBeCloseTo(0.4, 6);
  });
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run lib/audio/playback.test.ts`
Expected: FAIL. The new tests fail on `MIN_LEAD_SECONDS` not being exported (`SyntaxError`/undefined import); once that resolves, "never starts a frame at currentTime" fails with `expected 3 to be greater than 3`.

- [ ] **Step 4: Implement the lead-in**

In `lib/audio/playback.ts`, add the constant above the class:

```ts
/**
 * How far ahead of `currentTime` the first frame of a burst is scheduled.
 *
 * Measured 2026-09-23 (`scripts/probe-audio.mjs`): the server streams 10 ms
 * frames at ~1x real time with as little as 0 ms of margin. A browser has
 * already rendered past `currentTime` by its output latency — typically
 * 20-50 ms, more on Firefox and over Bluetooth — so a frame scheduled at
 * `currentTime` is scheduled into the past. Web Audio starts such a source
 * immediately instead, at the next render quantum, which means the first
 * several frames all start in the SAME quantum, stacked on top of each other
 * and summed. That burst is the garbled first word.
 *
 * 120 ms sits below the ~200 ms gap of ordinary human turn-taking, and an
 * unintelligible first word is the worse defect. The README's
 * time_to_first_audio_ms figure must include this, not just the 28 ms hop.
 */
export const MIN_LEAD_SECONDS = 0.12;
```

Add a private method to `ReplyPlayer`:

```ts
  /** Safari does not implement outputLatency, so the floor carries it there. */
  private leadIn(): number {
    const reported = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return Math.max(MIN_LEAD_SECONDS, reported * 2);
  }
```

Change line 23 of `enqueue` from:

```ts
    this.cursor = Math.max(this.cursor, this.ctx.currentTime);
```

to:

```ts
    // Math.max means the lead applies at the start of a burst and after a
    // drain or a flush, and costs nothing mid-sentence: once the cursor is
    // running ahead of the clock it already wins.
    this.cursor = Math.max(this.cursor, this.ctx.currentTime + this.leadIn());
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run lib/audio/playback.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/audio/playback.ts lib/audio/playback.test.ts
git commit -m "fix: schedule reply audio with a lead-in so the first word stops stacking"
```

---

### Task 2: A turn-taking state a deaf user can read

**Files:**
- Create: `lib/turn-state.ts`
- Test: `lib/turn-state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, imported by Tasks 3, 7 and 10:
  - `type TurnEvent = "ready" | "they-start" | "they-stop" | "reply-start" | "reply-end" | "closed"`
  - `interface TurnState { ready: boolean; theirs: boolean; ours: boolean }`
  - `const INITIAL_TURN: TurnState`
  - `function turnReducer(state: TurnState, event: TurnEvent): TurnState`
  - `type TurnLabel = "connecting" | "listening" | "theirs" | "yours"`
  - `function turnLabel(state: TurnState): TurnLabel`

- [ ] **Step 1: Write the failing test**

Create `lib/turn-state.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run lib/turn-state.test.ts`
Expected: FAIL — `Failed to resolve import "./turn-state"`.

- [ ] **Step 3: Implement**

Create `lib/turn-state.ts`:

```ts
/**
 * Whose turn it is, derived from events the socket already sends.
 *
 * A hearing person knows when to speak because they hear silence. A deaf user
 * has no such cue, so this is the single largest accessibility element on the
 * screen — and it costs nothing: `input.speech.started` was already arriving
 * and being used for one thing only (flushing playback), and
 * `input.speech.stopped` was being dropped entirely.
 *
 * Kept as a pure reducer so it is tested without a socket or a browser.
 */
export type TurnEvent = "ready" | "they-start" | "they-stop" | "reply-start" | "reply-end" | "closed";

export interface TurnState {
  ready: boolean;
  theirs: boolean;
  ours: boolean;
}

export type TurnLabel = "connecting" | "listening" | "theirs" | "yours";

export const INITIAL_TURN: TurnState = { ready: false, theirs: false, ours: false };

export function turnReducer(state: TurnState, event: TurnEvent): TurnState {
  switch (event) {
    case "ready":
      return { ...state, ready: true };
    case "closed":
      return INITIAL_TURN;
    default:
      break;
  }
  // Before session.ready nothing is a turn yet: audio sent early is discarded
  // server-side, so showing a turn for it would be a lie on screen.
  if (!state.ready) return state;

  switch (event) {
    case "they-start":
      return { ...state, theirs: true };
    case "they-stop":
      return { ...state, theirs: false };
    case "reply-start":
      return { ...state, ours: true };
    case "reply-end":
      return { ...state, ours: false };
    default:
      return state;
  }
}

export function turnLabel(state: TurnState): TurnLabel {
  if (!state.ready) return "connecting";
  if (state.theirs) return "theirs"; // precedence: spec 2.1
  if (state.ours) return "yours";
  return "listening";
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run lib/turn-state.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/turn-state.ts lib/turn-state.test.ts
git commit -m "feat: derive whose turn it is from the events already on the socket"
```

---

### Task 3: Emit the turn events from the relay client

**Files:**
- Modify: `lib/relay-client.ts:3-10` (the `RelayHandlers` interface), `:57-103` (`handle`)
- Test: `lib/relay-client.test.ts`

**Interfaces:**
- Consumes: `TurnEvent` from `lib/turn-state.ts` (Task 2).
- Produces: `RelayHandlers` gains one required member — `onTurn(event: TurnEvent): void`. Every construction site must pass it; Task 10 wires the real one.

- [ ] **Step 1: Write the failing test**

Append to `lib/relay-client.test.ts`:

```ts
  it("reports every turn event the screen needs, in order", async () => {
    const turns: TurnEvent[] = [];
    const { client } = connected({ onTurn: (e) => turns.push(e) });

    FakeSocket.last.receive({ type: "session.ready", session_id: "s1" });
    FakeSocket.last.receive({ type: "reply.started" });
    FakeSocket.last.receive({ type: "input.speech.started" });
    FakeSocket.last.receive({ type: "input.speech.stopped" });
    FakeSocket.last.receive({ type: "reply.done", status: "completed" });

    expect(turns).toEqual(["ready", "reply-start", "they-start", "they-stop", "reply-end"]);
    expect(client).toBeDefined();
  });

  it("reports the close so a dropped call cannot keep showing a live turn", async () => {
    const turns: TurnEvent[] = [];
    connected({ onTurn: (e) => turns.push(e) });
    FakeSocket.last.onclose?.({ code: 1006 } as CloseEvent);
    expect(turns).toContain("closed");
  });
```

Add to the imports at the top of that file:

```ts
import type { TurnEvent } from "./turn-state";
```

> **Note for the implementer:** `lib/relay-client.test.ts` already has helpers for building a client over `FakeSocket`. Read the top of the file and reuse whatever it already calls them; the two tests above assume a helper that returns `{ client }` and accepts partial handlers. If the existing helper has a different name or shape, adapt these two tests to it rather than adding a second helper.

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run lib/relay-client.test.ts`
Expected: FAIL — `onTurn` is not a property of `RelayHandlers` (TypeScript), and no turn events are recorded.

- [ ] **Step 3: Add `onTurn` to the handlers interface**

In `lib/relay-client.ts`, extend the interface (line 3-10):

```ts
import type { TurnEvent } from "./turn-state";

export interface RelayHandlers {
  onCaption(partial: string): void;
  onCaptionFinal(text: string): void;
  onSpoken(text: string, interrupted: boolean): void;
  onStatus(status: string): void;
  onError(message: string): void;
  /** Whose turn it is. Spec 2.1 — the largest accessibility element on screen. */
  onTurn(event: TurnEvent): void;
}
```

- [ ] **Step 4: Emit the events**

In `handle()`, add `this.handlers.onTurn(…)` calls. The full changed cases:

```ts
      case "session.ready":
        this.sessionId = message.session_id as string;
        this.handlers.onStatus("connected");
        this.handlers.onTurn("ready");
        break;
      case "input.speech.started":
        // Snappiest barge-in: stop our own audio the moment they start talking.
        this.player.flush();
        this.handlers.onTurn("they-start");
        break;
      case "input.speech.stopped":
        // Previously dropped entirely. This is the "your turn" cue.
        this.handlers.onTurn("they-stop");
        break;
      case "reply.started":
        this.handlers.onTurn("reply-start");
        break;
```

and in the existing `reply.done` case, after the flush line:

```ts
      case "reply.done":
        if (message.status === "interrupted") this.player.flush();
        this.handlers.onTurn("reply-end");
        break;
```

In `connect()`, inside `socket.onclose`, after the existing `onStatus("disconnected")` line:

```ts
      this.handlers.onTurn("closed");
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. If other tests in `relay-client.test.ts` construct handlers as object literals, TypeScript now requires `onTurn` on each — add `onTurn: () => {}` to those literals.

- [ ] **Step 6: Commit**

```bash
git add lib/relay-client.ts lib/relay-client.test.ts
git commit -m "feat: surface speech and reply lifecycle as turn events"
```

---

### Task 4: Give an interrupted sentence its remainder back

**Files:**
- Modify: `lib/ledger.ts` (append one exported function)
- Test: `lib/ledger.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, used by Task 10: `function remainderOf(typed: string, spoken: string): string`.

Measured basis (spec §2.5): typed `"Please repeat that."`, interrupted at 0.62 s, `transcript.agent` returned `interrupted=true, text="Please"`.

- [ ] **Step 1: Write the failing test**

Append to `lib/ledger.test.ts`:

```ts
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
```

Add `remainderOf` to the existing import in that file.

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run lib/ledger.test.ts`
Expected: FAIL — `remainderOf is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/ledger.ts`:

```ts
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

  const typedMatches = [...typed.matchAll(/\S+/g)];
  for (let i = 0; i < spokenWords.length; i += 1) {
    const typedWord = typedMatches[i];
    if (!typedWord || wordKey(typedWord[0]) !== spokenWords[i]) return typed;
  }

  const next = typedMatches[spokenWords.length];
  return next ? typed.slice(next.index).trim() : "";
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run lib/ledger.test.ts`
Expected: PASS, all existing tests plus 6 new.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger.ts lib/ledger.test.ts
git commit -m "feat: compute the unspoken remainder of an interrupted line"
```

---

### Task 5: Design tokens and type, with the contrast asserted in a test

**Files:**
- Modify: `app/globals.css` (full rewrite, 26 lines), `app/layout.tsx:1-18`
- Test: `lib/tokens.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind utility classes available to Tasks 6–10 — `bg-ink`, `bg-surface`, `bg-surface-up`, `border-line`, `text-text`, `text-text-dim`, `text-text-mute`, `text-mint`, `bg-mint`, `text-amber`, `bg-amber`, `text-slate`, `text-rose`, and the font variable `--font-hyper`.

The test is the point: the defect being fixed is borders at **1.4:1** and body text the same colour as its background. A regression here is invisible until someone opens a browser, which is how it shipped in the first place.

- [ ] **Step 1: Write the failing test**

Create `lib/tokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG 2.x relative luminance.
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const token = (name: string): string => {
  const found = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!found) throw new Error(`token --color-${name} is missing from app/globals.css`);
  return found[1];
};

describe("design tokens", () => {
  // Captions are the accessibility surface of this product, so AAA, not AA.
  it("puts caption text at AAA against both the page and a raised surface", () => {
    expect(contrast(token("text"), token("ink"))).toBeGreaterThanOrEqual(7);
    expect(contrast(token("text"), token("surface"))).toBeGreaterThanOrEqual(7);
  });

  // WCAG 2.1 SC 1.4.11. The borders this replaces measured 1.4:1 — the
  // "borders the same colour as everything" defect, stated as a number.
  it("puts every component boundary at 3:1, the non-text contrast floor", () => {
    expect(contrast(token("line"), token("ink"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("line"), token("surface"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps secondary and muted text readable", () => {
    expect(contrast(token("text-dim"), token("ink"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("text-mute"), token("ink"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every status colour readable on the page and on a surface", () => {
    for (const status of ["mint", "amber", "slate", "rose"]) {
      expect(contrast(token(status), token("ink"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(status), token("surface"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps ink legible as the text colour of a filled mint or amber chip", () => {
    expect(contrast(token("ink"), token("mint"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("ink"), token("amber"))).toBeGreaterThanOrEqual(4.5);
  });

  it("does not hardcode a font-family on body — layout.tsx owns the font", () => {
    expect(css).not.toMatch(/font-family:\s*Arial/i);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run lib/tokens.test.ts`
Expected: FAIL — `token --color-ink is missing from app/globals.css`.

- [ ] **Step 3: Replace `app/globals.css` entirely**

```css
@import "tailwindcss";

/**
 * Deep ink with a green cast.
 *
 * Not blue: InnoCaption owns #0b3797 and Rylo owns royal blue (measured from
 * their live CSS, 2026-09-23), and PRD 7 spends its length distinguishing
 * Aloud from exactly those two. Not purple: that is AssemblyAI's own brand,
 * and a sponsor-coloured UI reads as a template.
 *
 * Soft, dark and desaturated rather than black-with-neon, after DeafSpace's
 * Light and Color principle — recorded honestly in the interface spec 4.1,
 * including the part where its skin-tone rationale does not transfer to a
 * product with no video.
 *
 * Every value here is asserted in lib/tokens.test.ts. Change one and the test
 * tells you what it broke.
 */
@theme {
  --color-ink: #07100f;
  --color-surface: #0e1a19;
  --color-surface-up: #182a28;
  --color-line: #4a6e6a;
  --color-text: #e9f2ef;
  --color-text-dim: #a9bdb9;
  --color-text-mute: #7d918e;
  --color-mint: #7ff3c8;
  --color-amber: #d9901b;
  --color-slate: #6f93a3;
  --color-rose: #ff6b7f;

  --font-sans: var(--font-hyper), ui-sans-serif, system-ui, sans-serif;
}

body {
  background: var(--color-ink);
  color: var(--color-text);
}

/* Captions are read while someone is still talking. Never let one run the full
 * width of a desktop window: the captioning literature converges on 45
 * characters per line (interface spec 4.1). */
.measure {
  max-width: 45ch;
}

/* One visible focus treatment, everywhere, on the one control that matters
 * most — a user who cannot hear has no audible confirmation of anything. */
:focus-visible {
  outline: 2px solid var(--color-mint);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Switch the font and fix the page title in `app/layout.tsx`**

Replace lines 1–18 with:

```tsx
import type { Metadata } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";
import "./globals.css";

/**
 * Braille Institute, drawn so characters cannot be confused with one another.
 *
 * Not decoration: Usher syndrome — congenital deafness with progressive vision
 * loss — is a significant population within relay's users, and captions are
 * this product's accessibility surface.
 */
const hyperlegible = Atkinson_Hyperlegible({
  variable: "--font-hyper",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aloud",
  description:
    "Place a phone call without a stranger in it. You type; your words are spoken aloud, verbatim, and the receipt proves it.",
};
```

And in the same file, replace the `<html>` className so the old Geist variables are gone:

```tsx
    <html lang="en" className={`${hyperlegible.variable} h-full antialiased`}>
```

- [ ] **Step 5: Run the test and the build**

Run: `npx vitest run lib/tokens.test.ts && npm run build`
Expected: PASS, 6 tests. Build succeeds. The existing components still reference `slate-*` classes and will look wrong — that is expected and Tasks 6–10 replace them.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css app/layout.tsx lib/tokens.test.ts
git commit -m "feat: design tokens with contrast asserted in a test, and a real page title"
```

---

### Task 6: Put a sequence number on both sides of the conversation

**Files:**
- Modify: `lib/ledger.ts` (the `Utterance` and `LedgerEvent` types, and `ledgerReducer`)
- Test: `lib/ledger.test.ts`, `app/components/Ledger.test.tsx` (fixtures gain `seq`)

**Interfaces:**
- Consumes: nothing.
- Produces: `Utterance` gains `seq: number`; the `typed` variant of `LedgerEvent` gains `seq: number`. Task 7 sorts on it.

A single chronological column needs one ordering across two sources. The captions and the user's own lines arrive independently, so the page assigns a monotonic sequence as each lands.

- [ ] **Step 1: Write the failing test**

Append to `lib/ledger.test.ts`:

```ts
it("carries the sequence number from the typed event onto the utterance", () => {
  const state = ledgerReducer([], { type: "typed", id: "a", text: "hello", mode: "verbatim", seq: 7 });
  expect(state[0].seq).toBe(7);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run lib/ledger.test.ts`
Expected: FAIL — TypeScript rejects `seq` on the event, and `state[0].seq` is `undefined`.

- [ ] **Step 3: Add `seq` to the types and the reducer**

In `lib/ledger.ts`:

```ts
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
```

and in `ledgerReducer`'s `typed` branch:

```ts
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
```

- [ ] **Step 4: Fix the fixtures in both test files**

In `lib/ledger.test.ts`, add `seq` to every `{ type: "typed", … }` literal (use any increasing integers). In `app/components/Ledger.test.tsx`, add `seq: 0` to the `u()` factory's defaults on line 7-13:

```ts
const u = (over: Partial<Utterance>): Utterance => ({
  id: "1",
  seq: 0,
  typedText: "hello",
  spokenText: "hello",
  mode: "verbatim",
  status: "match",
  ...over,
});
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ledger.ts lib/ledger.test.ts app/components/Ledger.test.tsx
git commit -m "feat: sequence utterances so one column can carry both sides"
```

---

### Task 7: The timeline — one column, receipts inline

**Files:**
- Create: `app/components/Timeline.tsx`, `app/components/Timeline.test.tsx`
- Delete at the end of Task 10: `app/components/CaptionPane.tsx`, `app/components/Ledger.tsx`, `app/components/Ledger.test.tsx`

**Interfaces:**
- Consumes: `Utterance`, `verbatimCount` from `lib/ledger.ts`.
- Produces, used by Task 10:
  - `interface HeardLine { id: string; seq: number; text: string }`
  - `function Timeline(props: { heard: HeardLine[]; utterances: Utterance[]; partial: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `app/components/Timeline.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline, type HeardLine } from "./Timeline";
import type { Utterance } from "@/lib/ledger";

const u = (over: Partial<Utterance>): Utterance => ({
  id: "u1",
  seq: 1,
  typedText: "hello",
  spokenText: "hello",
  mode: "verbatim",
  status: "match",
  ...over,
});
const heard = (over: Partial<HeardLine>): HeardLine => ({ id: "h1", seq: 0, text: "Hello?", ...over });

describe("Timeline", () => {
  it("interleaves both sides in sequence order, not source order", () => {
    render(
      <Timeline
        heard={[heard({ id: "h1", seq: 0, text: "Hello?" }), heard({ id: "h2", seq: 2, text: "Sure." })]}
        utterances={[u({ id: "u1", seq: 1, typedText: "Hi, can we move Thursday?" })]}
        partial=""
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Hello?")).toBeDefined();
    expect(within(items[1]).getByText("Hi, can we move Thursday?")).toBeDefined();
    expect(within(items[2]).getByText("Sure.")).toBeDefined();
  });

  it("collapses a match to one line and a receipt, without repeating the text", () => {
    render(<Timeline heard={[]} utterances={[u({ typedText: "Yes.", spokenText: "Yes." })]} partial="" />);
    expect(screen.getByText(/spoken exactly/i)).toBeDefined();
    expect(screen.getAllByText("Yes.")).toHaveLength(1);
  });

  it("expands a verbatim mismatch to show both texts, and flags it", () => {
    render(
      <Timeline
        heard={[]}
        partial=""
        utterances={[
          u({ status: "mismatch", typedText: "make appointment", spokenText: "I'd like to make an appointment." }),
        ]}
      />,
    );
    expect(screen.getByText(/altered/i)).toBeDefined();
    expect(screen.getByText("make appointment")).toBeDefined();
    expect(screen.getByText("I'd like to make an appointment.")).toBeDefined();
  });

  it("shows what did not get out when a line was interrupted", () => {
    render(
      <Timeline
        heard={[]}
        partial=""
        utterances={[u({ status: "interrupted", typedText: "Please repeat that.", spokenText: "Please" })]}
      />,
    );
    expect(screen.getByText(/interrupted/i)).toBeDefined();
    expect(screen.getByText(/repeat that\./)).toBeDefined();
  });

  // Carried over from Ledger.test.tsx — an intentional paraphrase the user
  // delegated is not an alteration, and must never get the amber treatment.
  it("calls an assistant-mode mismatch a paraphrase and does not flag it", () => {
    render(
      <Timeline
        heard={[]}
        partial=""
        utterances={[u({ mode: "assistant", status: "mismatch", typedText: "press 2", spokenText: "Pressing two now." })]}
      />,
    );
    const label = screen.getByText(/assistant spoke/i);
    expect(label).toBeDefined();
    expect(screen.queryByText(/altered/i)).toBeNull();
    expect(label.className).not.toContain("amber");
  });

  it("shows the running verbatim count and excludes assistant lines from it", () => {
    render(
      <Timeline heard={[]} partial="" utterances={[u({}), u({ id: "u2", seq: 2, mode: "assistant" })]} />,
    );
    expect(screen.getByText(/1 of 1 spoken exactly/i)).toBeDefined();
  });

  it("shows the in-flight partial caption last, marked as not final", () => {
    render(<Timeline heard={[heard({})]} utterances={[]} partial="I was thinking" />);
    const live = screen.getByText("I was thinking");
    expect(live.closest("[aria-live]")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run app/components/Timeline.test.tsx`
Expected: FAIL — `Failed to resolve import "./Timeline"`.

- [ ] **Step 3: Implement**

Create `app/components/Timeline.tsx`:

```tsx
"use client";
import { verbatimCount, type Utterance } from "@/lib/ledger";

export interface HeardLine {
  id: string;
  seq: number;
  text: string;
}

/** Four redundant channels per status — icon, word, form, colour — because the
 * captioning literature is clear that colour alone loses colourblind users,
 * and because --amber and --slate separate by only 1.25:1 in greyscale
 * (interface spec 4.2). */
const RECEIPT: Record<Utterance["status"], { icon: string; word: string }> = {
  pending: { icon: "•", word: "speaking…" },
  match: { icon: "✓", word: "spoken exactly" },
  mismatch: { icon: "!", word: "altered" },
  interrupted: { icon: "‖", word: "interrupted" },
};

function receiptFor(u: Utterance) {
  if (u.mode === "assistant" && u.status === "mismatch") return { icon: "~", word: "assistant spoke" };
  return RECEIPT[u.status];
}

/** Only a VERBATIM mismatch is an alteration. An assistant paraphrase is
 * something the user delegated on purpose; flagging it amber would mislabel
 * their own choice as our failure. */
const isAltered = (u: Utterance) => u.mode === "verbatim" && u.status === "mismatch";

function Heard({ text }: { text: string }) {
  return (
    <li className="border-l-2 border-line pl-4">
      <p className="text-[13px] uppercase tracking-widest text-text-mute">they said</p>
      <p className="measure text-xl leading-relaxed text-text">{text}</p>
    </li>
  );
}

function Said({ u }: { u: Utterance }) {
  const receipt = receiptFor(u);
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <p className="measure text-xl leading-relaxed text-text">{u.typedText}</p>

      <p
        className={
          isAltered(u)
            ? "mt-3 inline-flex items-center gap-2 rounded bg-amber px-2 py-1 text-[13px] font-bold text-ink"
            : `mt-3 inline-flex items-center gap-2 text-[13px] ${u.status === "interrupted" ? "text-slate" : "text-mint"}`
        }
      >
        <span aria-hidden="true">{receipt.icon}</span>
        {receipt.word}
      </p>

      {isAltered(u) && u.spokenText !== null && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[13px] uppercase tracking-widest text-text-mute">actually spoken</p>
          <p className="measure text-xl leading-relaxed text-text">{u.spokenText}</p>
        </div>
      )}
    </li>
  );
}

export function Timeline({
  heard,
  utterances,
  partial,
}: {
  heard: HeardLine[];
  utterances: Utterance[];
  partial: string;
}) {
  const { matched, total } = verbatimCount(utterances);
  const items = [
    ...heard.map((h) => ({ seq: h.seq, key: `h${h.id}`, node: <Heard key={`h${h.id}`} text={h.text} /> })),
    ...utterances.map((u) => ({ seq: u.seq, key: `u${u.id}`, node: <Said key={`u${u.id}`} u={u} /> })),
  ].sort((a, b) => a.seq - b.seq);

  return (
    <section aria-label="Call" className="flex flex-col gap-4">
      <h2 className="text-[13px] uppercase tracking-widest text-text-mute">
        {matched} of {total} spoken exactly
      </h2>

      <ol className="flex flex-col gap-5">{items.map((i) => i.node)}</ol>

      {/* The line still being said. aria-live so a screen reader announces it
        * as it arrives — a deaf user may also be a screen-reader user. */}
      <p aria-live="polite" className="measure text-xl leading-relaxed text-text-dim">
        {partial}
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run app/components/Timeline.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add app/components/Timeline.tsx app/components/Timeline.test.tsx
git commit -m "feat: one chronological timeline with the verbatim receipt inline"
```

---

### Task 8: The turn indicator

**Files:**
- Create: `app/components/TurnIndicator.tsx`, `app/components/TurnIndicator.test.tsx`

**Interfaces:**
- Consumes: `TurnLabel` from `lib/turn-state.ts` (Task 2).
- Produces, used by Task 10: `function TurnIndicator({ label }: { label: TurnLabel }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `app/components/TurnIndicator.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TurnIndicator } from "./TurnIndicator";

describe("TurnIndicator", () => {
  it("says whose turn it is in words, not only in colour", () => {
    render(<TurnIndicator label="theirs" />);
    expect(screen.getByText(/they're speaking/i)).toBeDefined();
  });

  it("tells the user when the line is theirs to take", () => {
    render(<TurnIndicator label="listening" />);
    expect(screen.getByText(/your turn/i)).toBeDefined();
  });

  it("says when the user's own words are going out", () => {
    render(<TurnIndicator label="yours" />);
    expect(screen.getByText(/speaking your words/i)).toBeDefined();
  });

  it("announces changes to assistive technology", () => {
    render(<TurnIndicator label="theirs" />);
    expect(screen.getByRole("status")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run app/components/TurnIndicator.test.tsx`
Expected: FAIL — `Failed to resolve import "./TurnIndicator"`.

- [ ] **Step 3: Implement**

Create `app/components/TurnIndicator.tsx`:

```tsx
"use client";
import type { TurnLabel } from "@/lib/turn-state";

/**
 * The loudest thing on the screen, and the reason is not decorative: a hearing
 * person knows when to speak because they hear silence, and a deaf user has no
 * such cue at all. Interface spec 2.1.
 */
const STATE: Record<TurnLabel, { text: string; dot: string; tone: string }> = {
  connecting: { text: "Connecting…", dot: "bg-text-mute", tone: "text-text-mute" },
  listening: { text: "Your turn", dot: "bg-mint", tone: "text-mint" },
  theirs: { text: "They're speaking", dot: "bg-amber animate-pulse", tone: "text-amber" },
  yours: { text: "Speaking your words", dot: "bg-slate animate-pulse", tone: "text-slate" },
};

export function TurnIndicator({ label }: { label: TurnLabel }) {
  const state = STATE[label];
  return (
    <p
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 text-2xl font-bold ${state.tone}`}
    >
      <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${state.dot}`} />
      {state.text}
    </p>
  );
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run app/components/TurnIndicator.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/components/TurnIndicator.tsx app/components/TurnIndicator.test.tsx
git commit -m "feat: show whose turn it is, in words and not only in colour"
```

---

### Task 9: Composer, setup card and the deletion receipt

**Files:**
- Modify: `app/components/Composer.tsx` (make the draft controlled)
- Create: `app/components/CallSetup.tsx`, `app/components/CallEnded.tsx`, `app/components/Composer.test.tsx`
- Delete: `app/components/StatusBar.tsx` (replaced by `TurnIndicator` plus the header in Task 10)

**Interfaces:**
- Consumes: nothing new.
- Produces, used by Task 10:
  - `function Composer(props: { value: string; onChange: (v: string) => void; onSend: (text: string, mode: RelayMode) => void; mode: RelayMode; onModeChange: (m: RelayMode) => void; disabled: boolean }): JSX.Element`
  - `function CallSetup({ onStart, connecting }: { onStart: () => void; connecting: boolean }): JSX.Element`
  - `function CallEnded({ deletion, matched, total }: { deletion: string | null; matched: number; total: number }): JSX.Element`

The composer must become **controlled** — Task 10 writes the remainder of an interrupted line straight into it, and it cannot do that while `Composer` owns the text in its own `useState` (`app/components/Composer.tsx:24`).

- [ ] **Step 1: Write the failing test**

Create `app/components/Composer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

const props = {
  value: "",
  onChange: () => {},
  onSend: () => {},
  mode: "verbatim" as const,
  onModeChange: () => {},
  disabled: false,
};

describe("Composer", () => {
  it("shows the value it is given rather than its own state", () => {
    render(<Composer {...props} value="repeat that." />);
    expect(screen.getByRole("textbox", { name: /type/i })).toHaveProperty("value", "repeat that.");
  });

  it("reports every keystroke upward", async () => {
    const onChange = vi.fn();
    render(<Composer {...props} onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox", { name: /type/i }), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("sends on Enter and does not send an empty line", async () => {
    const onSend = vi.fn();
    render(<Composer {...props} value="  " onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox", { name: /type/i }), "{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends the trimmed line with the current mode", async () => {
    const onSend = vi.fn();
    render(<Composer {...props} value=" Yes. " onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox", { name: /type/i }), "{Enter}");
    expect(onSend).toHaveBeenCalledWith("Yes.", "verbatim");
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run app/components/Composer.test.tsx`
Expected: FAIL — `Composer` does not accept `value`/`onChange`; the textbox keeps its own state.

- [ ] **Step 3: Rewrite `app/components/Composer.tsx`**

```tsx
"use client";
import type { RelayMode } from "@/lib/sentinel";

const QUICK = [
  "I'm using a relay service — please speak normally.",
  "Please repeat that.",
  "Please hold on.",
  "Yes.",
  "No.",
];

export function Composer({
  value,
  onChange,
  onSend,
  mode,
  onModeChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string, mode: RelayMode) => void;
  mode: RelayMode;
  onModeChange: (mode: RelayMode) => void;
  disabled: boolean;
}) {
  // Controlled from the page: when a line is cut off by the hearing party
  // talking over it, the page writes the unspoken remainder back in here so
  // pressing Enter continues the sentence. Interface spec 2.5.
  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, mode);
    onChange("");
  }

  return (
    <section aria-label="Compose" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {QUICK.map((phrase) => (
          <button
            key={phrase}
            type="button"
            disabled={disabled}
            onClick={() => send(phrase)}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-text-dim hover:bg-surface-up disabled:opacity-50"
          >
            {phrase}
          </button>
        ))}
      </div>

      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(value);
          }
        }}
        aria-label="Type what you want said"
        placeholder="Type here. Enter speaks it."
        className="min-h-28 rounded-lg border border-line bg-surface-up p-4 text-xl leading-relaxed text-text placeholder:text-text-mute disabled:opacity-50"
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mode === "assistant"}
          disabled={disabled}
          onChange={(e) => onModeChange(e.target.checked ? "assistant" : "verbatim")}
        />
        <span className={mode === "assistant" ? "font-bold text-amber" : "text-text-dim"}>
          {mode === "assistant"
            ? "ASSISTANT IS SPEAKING — it handles menus and hold, and never answers for you"
            : "Assistant mode (menus and hold only) — off"}
        </span>
      </label>
    </section>
  );
}
```

- [ ] **Step 4: Create `app/components/CallSetup.tsx`**

```tsx
"use client";

/**
 * The demo is a real phone call: the laptop is the relay, a phone on speaker
 * beside it is the line, and the hearing party is a real person somewhere
 * else. Interface spec 1.1. Without this card the screen reads as two people
 * sitting at one laptop, which is not the product.
 */
const STEPS = [
  "Dial the number on your phone.",
  "Put the phone on speaker.",
  "Set it beside this laptop, screen up.",
  "Start the call here — your words come out of this laptop, into the phone.",
];

export function CallSetup({ onStart, connecting }: { onStart: () => void; connecting: boolean }) {
  return (
    <section aria-label="Before you start" className="flex flex-col gap-6">
      <p className="measure text-2xl leading-relaxed text-text">
        You type. Your words are spoken on the line, exactly as you wrote them. The other person
        talks, and you read it here.
      </p>

      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <li key={step} className="flex gap-3 text-lg text-text-dim">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-sm text-text-mute">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <button
        onClick={onStart}
        disabled={connecting}
        className="self-start rounded-lg bg-mint px-6 py-3 text-lg font-bold text-ink disabled:opacity-60"
      >
        {connecting ? "Connecting…" : "Start the call"}
      </button>
    </section>
  );
}
```

- [ ] **Step 5: Create `app/components/CallEnded.tsx`**

```tsx
"use client";

/**
 * The last frame of the submission video. It previously rendered as 14px green
 * text inside a header.
 *
 * The word stays "deleted": DELETE /v1/sessions/{id} is a documented SOFT
 * delete. Never "erased", never "destroyed". Repo honesty rule.
 */
export function CallEnded({
  deletion,
  matched,
  total,
}: {
  deletion: string | null;
  matched: number;
  total: number;
}) {
  return (
    <section aria-label="Call ended" className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
      <p className="text-3xl font-bold text-text">Call ended</p>
      <p className="text-xl text-mint">
        {matched} of {total} lines spoken exactly as you typed them
      </p>
      <p className="measure text-lg text-text-dim">
        {deletion ?? "Deleting the provider's recording…"}
      </p>
    </section>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run app/components/Composer.test.tsx && npm run build`
Expected: PASS, 4 tests. Build succeeds. `app/page.tsx` still passes the old `Composer` props and will fail typecheck — Task 10 fixes it. If the build fails only on `page.tsx`, continue.

- [ ] **Step 7: Commit**

```bash
git add app/components/Composer.tsx app/components/Composer.test.tsx app/components/CallSetup.tsx app/components/CallEnded.tsx
git commit -m "feat: controlled composer, call setup card and a real deletion receipt"
```

---

### Task 10: Assemble the page

**Files:**
- Modify: `app/page.tsx` (render body and state; the connection logic in `startCall`/`hangUp` is NOT restructured)
- Delete: `app/components/CaptionPane.tsx`, `app/components/Ledger.tsx`, `app/components/Ledger.test.tsx`, `app/components/StatusBar.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 2, 4, 6, 7, 8, 9.
- Produces: the finished screen.

- [ ] **Step 1: Replace the imports and add the new state**

In `app/page.tsx`, replace the component imports (lines 3-6) with:

```tsx
import { CallEnded } from "./components/CallEnded";
import { CallSetup } from "./components/CallSetup";
import { Composer } from "./components/Composer";
import { Timeline, type HeardLine } from "./components/Timeline";
import { TurnIndicator } from "./components/TurnIndicator";
```

and add to the ledger/turn imports:

```tsx
import { ledgerReducer, remainderOf, verbatimCount, type LedgerEvent, type Utterance } from "@/lib/ledger";
import { INITIAL_TURN, turnLabel, turnReducer, type TurnEvent } from "@/lib/turn-state";
```

Replace the `finals` state (line 20) and add the rest:

```tsx
  const [heard, setHeard] = useState<HeardLine[]>([]);
  const [draft, setDraft] = useState("");
  const [turn, setTurn] = useState(INITIAL_TURN);
  const [ended, setEnded] = useState(false);
  // One monotonic counter across BOTH sides, so the timeline is one column in
  // real order rather than two lists stitched together. A ref, not state:
  // it must increment during an event handler without waiting for a render.
  const seq = useRef(0);
```

- [ ] **Step 2: Rewrite the handlers passed to `connectWithRecovery`**

Replace the handler object inside `startCall` (currently lines 77-96) with:

```tsx
          {
            onCaption: setPartial,
            onCaptionFinal: (text) => {
              seq.current += 1;
              setHeard((h) => [...h, { id: crypto.randomUUID(), seq: seq.current, text }]);
              setPartial("");
            },
            onSpoken: (text, interrupted) => {
              push({ type: "spoken", text, interrupted });
              // Interface spec 2.5: hand the unspoken remainder back to the
              // composer so pressing Enter finishes the sentence. The ledger
              // row itself stays logged as `interrupted` — nothing is
              // retroactively edited.
              if (interrupted) {
                setUtterances((state) => {
                  const cut = state.find((u) => u.status === "pending");
                  if (cut) setDraft(remainderOf(cut.typedText, text));
                  return state;
                });
              }
            },
            onStatus: (status) => {
              setStatus(status);
              if (status === "disconnected" && !intentionalHangup.current) {
                setError("The call ended unexpectedly.");
                void hangUp();
              }
            },
            onTurn: (event: TurnEvent) => setTurn((t) => turnReducer(t, event)),
            onError: setError,
          },
```

> **Note for the implementer:** reading the pending utterance inside `setUtterances` is deliberate — `onSpoken` fires in the same tick as `push()`, so the component's `utterances` closure is stale. The updater gives the current value. It returns `state` unchanged; only the `setDraft` is a side effect.

- [ ] **Step 3: Set `ended` in `hangUp` and reset it in `startCall`**

In `hangUp()`, immediately after `setLive(false)`:

```tsx
    setEnded(true);
```

In `startCall()`, next to the existing `setError(null)`:

```tsx
    setEnded(false);
    setHeard([]);
    setUtterances([]);
    setDraft("");
    setTurn(INITIAL_TURN);
    seq.current = 0;
```

- [ ] **Step 4: Replace the render body (lines 198-236)**

```tsx
  const { matched, total } = verbatimCount(utterances);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-4">
        <span className="text-2xl font-bold tracking-tight text-text">Aloud</span>
        <span className="text-[13px] uppercase tracking-widest text-text-mute">{status}</span>
      </header>

      {error && <p className="rounded-lg border border-rose px-4 py-3 text-rose">{error}</p>}
      {notice && <p className="rounded-lg border border-amber px-4 py-3 text-amber">{notice}</p>}

      {!live && !ended && <CallSetup onStart={startCall} connecting={connecting} />}

      {ended && <CallEnded deletion={deletion} matched={matched} total={total} />}

      {live && (
        <>
          <TurnIndicator label={turnLabel(turn)} />

          <Timeline heard={heard} utterances={utterances} partial={partial} />

          <Composer
            value={draft}
            onChange={setDraft}
            disabled={!live}
            mode={mode}
            onModeChange={setMode}
            onSend={(text, sendMode) => {
              const id = client.current!.say(text, sendMode);
              seq.current += 1;
              push({ type: "typed", id, seq: seq.current, text, mode: sendMode });
            }}
          />

          <button
            onClick={hangUp}
            className="self-start rounded-lg border border-rose px-5 py-3 font-bold text-rose hover:bg-rose hover:text-ink"
          >
            Hang up and delete the recording
          </button>
        </>
      )}
    </main>
  );
```

- [ ] **Step 5: Delete the replaced components**

```bash
git rm app/components/CaptionPane.tsx app/components/Ledger.tsx app/components/Ledger.test.tsx app/components/StatusBar.tsx
```

- [ ] **Step 6: Verify the whole suite, lint and build**

Run: `npm test && npm run lint && npm run build`
Expected: all tests pass. Lint shows **exactly the 10 known pre-existing errors**, no more. Build succeeds.

Also run: `grep -rn "sampleRate" app lib public`
Expected: hits only in `public/pcm-processor.js` and on `ctx.sampleRate`. Any other hit is the Firefox echo-cancellation bug being reintroduced.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: assemble the one-person relay console"
```

---

### Task 11: Verify it on real hardware, and check the thing that could embarrass us on camera

**Files:**
- Modify: `docs/BROWSER-NOTES.md`, `README.md`
- Create: nothing

**Interfaces:**
- Consumes: the deployed app.
- Produces: filled-in browser notes and one honest latency number.

This task cannot be done by an agent. It is written out so the human doing it has an exact checklist.

- [ ] **Step 1: Deploy**

```bash
npx vercel --prod --yes
node scripts/gate-probe.mjs https://aloud-implementation.vercel.app
```

Expected: G3 mean latency printed, G4 all three utterances byte-identical. If G4 regresses, stop — something in this plan touched the pass-through, which it must not.

- [ ] **Step 2: The echo-cancellation check, in every browser**

Set up as the product intends: laptop running Aloud, a phone on speaker beside it, a real call to a real person.

Type one line. Then watch the timeline for **ten seconds without anyone speaking**.

- PASS: nothing new appears under "they said".
- **FAIL: the line you just typed appears as something they said.** That is the laptop's AEC failing and the microphone captioning our own text-to-speech. Interface spec 1.1. Do not film until this passes. Firefox is the expected failure.

Record the result per browser in `docs/BROWSER-NOTES.md` under a heading `## Echo cancellation (AEC) — self-caption check`.

- [ ] **Step 3: The first-word check**

Type `Hello, I'm calling about Thursday.` Listen to the first word.

- PASS: "Hello" is a clean word.
- FAIL: it is a burst or a stutter. Raise `MIN_LEAD_SECONDS` in `lib/audio/playback.ts` to `0.2` and re-test.

Record per browser.

- [ ] **Step 4: The barge-in and resume check**

Type `Please repeat that.` and talk over it as it begins.

Expected: audio stops; the timeline row says `interrupted`; the composer now contains the unspoken remainder; pressing Enter speaks it and adds a second row.

- [ ] **Step 5: Measure the real latency**

With a call live, read `time_to_first_audio_ms` from the session timeline before the session is deleted. Put it in `README.md` as a measured number **including the 120 ms lead-in**, stated as such — not the 28 ms hop on its own.

- [ ] **Step 6: Fill in the browser matrix and commit**

`docs/BROWSER-NOTES.md` must name Chrome, Firefox and Safari with a real verdict on each of steps 2, 3 and 4. An unchecked row stays written as `NOT TESTED`, never as a pass.

```bash
git add docs/BROWSER-NOTES.md README.md
git commit -m "docs: browser matrix and the measured latency, including the lead-in"
```

---

## Self-review

**Spec coverage.** §1 → Task 9 (`CallSetup`) and Task 11 Step 2. §2.1 → Tasks 2, 3, 8. §2.2 → Task 8 (`yours` state). §2.3 → Task 7. §2.4 → Tasks 6, 7. §2.5 → Tasks 4, 9, 10. §3 → Task 1. §4.1/4.2 → Task 5. §4.3 → Task 5. §5 → Tasks 9, 10. §6 is out-of-scope statements, nothing to build.

**Known gaps, stated rather than hidden:**

- **Assistant mode is untouched.** It keeps working through the rebuilt composer; nothing in the spec changes it. If the day slips, `docs/TASKS.md` cuts it second.
- **`heard` grows unbounded** over a 600-second call. At relay speeds that is tens of entries, not thousands. Not worth virtualising before the deadline; noted so it is a decision and not an oversight.
- **Task 11 cannot be automated.** Real microphone, real speaker, real phone. It is the task most likely to be skipped and the one that caught nothing last time because it was skipped.

**Type consistency check:** `TurnEvent`/`TurnState`/`turnLabel` (Task 2) are consumed under those exact names in Tasks 3, 8 and 10. `HeardLine` (Task 7) is constructed in Task 10 with `{ id, seq, text }`, matching. `Utterance.seq` (Task 6) is read by `Timeline` (Task 7) and written by `push({ type: "typed", … seq })` (Task 10). `remainderOf` (Task 4) is called in Task 10 with `(typedText, text)`. `MIN_LEAD_SECONDS` (Task 1) is referenced again in Task 11 Step 3.
