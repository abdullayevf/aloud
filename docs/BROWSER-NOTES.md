# Cross-Browser Compatibility Matrix

**Reset 2026-09-25.** The previous pass in this file (Chrome/Safari PASS, Firefox
PASS-with-a-stutter) was measured against a build **three commits stale** — the
capture worklet, playback, the caption timeline and the whole live screen have
all changed since (the 2026-09-25 kinetic-caption work). Those results describe
code nobody is submitting, so they are reset rather than carried forward.

## Test Procedure

Each row tests:
1. Greeting audible
2. Typed text spoken
3. Ledger match
4. Mic captions appear
5. Barge-in stops audio
6. Hangup deletes recording (confirmed on screen)
7. **New:** the word ink advances in step with the voice, and **freezes at the
   word it had reached** when the hearing party talks over the line — it must
   not jump to the whole line solid, and it must not blank. The frozen split is
   an approximation; the row then settles and `remainderOf()` replaces it with
   the definitive one.
8. **New:** exactly one word carries the stroke at a time, the stroke grows
   from the left across that word, and it **does not blink out between words**
   (the measured timings have gaps; `inkWords` holds the current word through
   them on purpose). A long word is underlined visibly more slowly than a short
   one — that is the stroke taking the word's own duration, not a bug. The
   stroke must sit under the word and not run out into the space after it.
9. **New:** on a barge-in, the stroke stops *inside* the word the voice was cut
   off on rather than sliding to the end of it.
10. **New:** with `prefers-reduced-motion: reduce` set in the OS, the line being
   spoken shows as plain typed text with no ink and no stroke at all. Settled
   rows look the same either way.

| Browser | Version | Greeting | Text Spoken | Ledger Match | Mic Captions | Barge-in Stops | Deletion Confirmed | Word Ink | Stroke | Notes |
|---------|---------|----------|-------------|--------------|--------------|-----------------|--------------------|----------|--------|----|
| Chrome | not recorded | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | |
| Firefox | not recorded | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | See "Firefox: the first-call stutter" below — prior evidence, not yet re-confirmed against this build. |
| Safari | not recorded | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | PENDING — re-test required after the 2026-09-26 caption work | |

## Firefox: the first-call stutter

**Prior evidence, kept intact from the pre-reset pass** — not reproduced against
the current build, and not to be treated as confirmed for it either.

Reported as intermittent, first call only, clearing on later calls in the same
session. **Not diagnosed** — no capture, no measurement, no root cause. It is
recorded here rather than dismissed because it sits exactly where this stack's
known failure lives.

The standing suspicion documented in `CLAUDE.md` is echo cancellation: Firefox
honours a requested `sampleRate` and silently drops AEC when it gets one, which
makes the agent interrupt itself. That is **not** what was observed — the
reported symptom is choppy audio on first play, not self-interruption — so the
two are probably unrelated, and the guard still holds:

```
grep -rn "sampleRate" app lib public   # must only find the worklet and ctx.sampleRate
```

A first-play stutter that clears is more consistent with AudioContext warm-up:
the first `AudioBufferSourceNode` being scheduled before the context has settled,
so the lead-in added in `46b807c` is too short on a cold Firefox context. That is
**UNVERIFIED** — a hypothesis to test, not a finding.

**Impact on the submission: low.** It is intermittent, cosmetic, and (previously)
cleared on its own. If the demo video is recorded in Chrome it will not appear at
all. Worth one timed experiment if the schedule allows; not worth risking the
deadline.
