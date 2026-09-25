# Kinetic captions — design

**Date:** 2026-09-25 · **Status:** agreed, ready to plan
**Supersedes nothing.** Extends the interface spec (`2026-09-23-aloud-interface.md`) §2.1 and §2.5.

## 0. Why

A hearing person on a call receives a continuous stream of information: that someone is talking, how loud, how fast, when they paused, when they cut in. A deaf user of Aloud currently receives text that arrives in lumps, plus one small turn indicator.

`lib/turn-state.ts` already states the principle — *"A hearing person knows when to speak because they hear silence. A deaf user has no such cue."* It applied that once and stopped. This spec applies it to the rest of the screen.

**Inspiration, credited not claimed:** [Caption with Intention](https://www.captionwithintention.org/) (Chicago Hearing Society, RAISE partner of the Academy) maps colour to speaker, animation to delivery, font size to volume and font weight to pitch. It is explicitly a **non-automated** system for human annotators working on post-produced film. Aloud borrows its visual grammar and drives it from live machine signal. The README and the submission must say so in those terms.

## 1. The governing rule

**Every visual channel is bound to a physical measurement. Anything we cannot measure gets no channel.**

| Channel | Bound to | Source | Status |
|---|---|---|---|
| Voice trace amplitude | hearing party's real loudness | RMS of our own mic float samples | build |
| Word ink | when each word is actually spoken | `transcript.agent.delta` `start_ms`/`end_ms` + playback clock | build |
| Ink freeze point | a real barge-in | `input.speech.started` / `reply.done status=interrupted` | build |
| Ghosted tail | what never left | `remainderOf(typed, spoken)` | build |
| Pitch → font weight | — | F0 estimate off a phone speaker is noisy | **rejected** |
| Emotion / sentiment | — | not measured at all | **rejected** |

Rendering inferred emotion would put feeling into the hearing party's mouth. That is the mirror image of rewriting the user's words, which is the thing this product exists to prevent. The rejection is a design commitment, not an omission.

## 2. Measured facts this design rests on

From `docs/research/gate-results-2026-09-22.md`, "`transcript.agent.delta` — measured 2026-09-25":

- Deltas **do** arrive on the custom-LLM path and **do** carry `start_ms`/`end_ms`.
- The field is **`delta`**, not `text`. Each delta is **one word including its trailing space**. They are **not cumulative** — the opposite convention to `transcript.user.delta`.
- **The whole timeline arrives in one burst** (~4 ms wide, ~365 ms after first audio) carrying timings spanning the full reply. It is a complete map delivered up front, not a stream tracking playback.
- The first word starts at ~296 ms; reply audio opens with leading silence.
- `reply_id` / `item_id` scope each delta to its reply.

**Consequence:** the ink is driven entirely by our own playback clock against a table we already hold. Nothing about rendering depends on delta arrival timing.

## 3. Two tiers, kept distinct

- **Live ink** — a moving approximation driven by a predicted timeline. It says *"this is roughly where the voice is now."*
- **Settled receipt** — the final `transcript.agent` plus the `interrupted` flag, which is what the ledger compares and what the user's verification rests on.

The ink moves; the receipt decides. No visual state may imply the receipt before `transcript.agent` has arrived — the existing rule that `pending` renders in `mute`, never in the verified green, extends to the ink.

## 4. The voice trace

`public/pcm-processor.js` already holds the hearing party's raw float samples (their phone on speaker, into our mic) and discards everything but resampled bytes. It gains an RMS computation over each render quantum, posted alongside the PCM.

- **Cadence:** one value per render quantum — ~375/s at 48 kHz. Never drives React state. Values land in a ring buffer held in a ref; a canvas redraws at 60 fps off `requestAnimationFrame`.
- **Stillness is preserved.** `app/globals.css` argues that stillness is what makes motion readable — *"If everything pulsed, nothing would."* The trace moves only when there is real sound and renders flat during real silence, so stillness keeps its meaning and becomes the absence of a measured thing rather than the absence of an animation.
- **It leads the captions.** Amplitude is instant; ASR lags roughly a second. The trace shows someone started talking before their caption exists.
- **Reduced motion:** `prefers-reduced-motion` drops the scrolling travel; the level is still rendered, without horizontal movement.
- **Accessibility:** the canvas is `aria-hidden`. The turn label keeps carrying the accessible text, unchanged.
- **The turn indicator is not replaced.** The trace shows *sound*; the label shows *whose turn*. During the user's own reply the trace is quiet while the turn is theirs. Different facts, both needed. They merge into one element so the vertical budget does not grow.
- **Echo note:** with echo cancellation working, our own TTS does not appear in the trace. If Firefox loses AEC (the documented failure in `CLAUDE.md`), our outgoing audio will appear — which makes the trace a free visual diagnostic for that bug rather than a lie, provided nothing labels the trace as "them" exclusively.

## 5. The ink

A reply's word timeline is accumulated from its deltas, keyed by `reply_id`. `ReplyPlayer` exposes elapsed milliseconds since the current reply's audio began. Words whose `start_ms` is at or before elapsed render solid; the rest render ghosted.

Because `start_ms` and the audio stream share an origin, the ~296 ms of leading silence needs no correction: nothing inks until the voice actually starts, which is correct.

On barge-in the player flushes, elapsed freezes, and the ink stops at the word being spoken. The settled row then replaces the approximation with `remainderOf()`'s definitive split.

## 6. The interruption, end to end

1. `input.speech.started` → `player.flush()` (already implemented) → ink freezes
2. `reply.done status=interrupted` → turn ends
3. `transcript.agent` with `interrupted: true` → ledger settles the row
4. `ledgerReducer` computes `remainder` via `remainderOf(typedText, spokenText)`
5. The row renders the spoken part solid and the remainder ghosted
6. The remainder auto-fills the composer **only when the composer is empty** — which is the normal case, since it clears on send — announced and reversible through the notice mechanism `Composer` already has for autocorrect

**Bug this replaces.** `app/page.tsx:107` calls `push()` (queueing the ledger reducer, which flips the row from `pending` to `interrupted`) and then queues a second updater that searches for a row still `pending`. It never finds one, so `setDraft` never runs and `remainderOf()` — correct and unit-tested — is unreachable. Moving the computation into `ledgerReducer` removes the ordering hazard entirely and makes it testable without React.

## 7. Density (the crowding fix)

Measured from class names, not a browser: live chrome totals roughly 440 px (header, turn bar, quick phrases, 112 px textarea, notice row, a permanent 44 px hang-up button, gaps). On a 900 px viewport the transcript gets ~460 px while a turn pair costs ~164 px — **under three exchanges visible**.

- A matched line loses the bordered card and the `✓ spoken exactly` chip, keeping a left rule and a small mark. The common case stops shouting.
- `mismatch` keeps the loud filled treatment. It should be loud.
- The content column aligns to `.measure` so the card edge and scrollbar relate to the text instead of floating ~290 px out — the "boxed in" feeling.
- Hang-up moves into the header.
- Four redundant channels per status (icon, word, form, colour last) survive unchanged; 45ch captions survive unchanged.

## 8. Out of scope

- **Suppressing short interruptions** ("mhm", "yeah"). Barge-in is AssemblyAI's managed VAD. Suppressing it means letting audio keep playing after someone tried to stop it — unauthorised words continuing down the line. Wrong trade on a relay. Logged as a known limitation.
- Pitch, emotion, sentiment (§1).
- Any change to the verbatim pass-through. `/api/llm/v1/chat/completions` is untouched by this work.
