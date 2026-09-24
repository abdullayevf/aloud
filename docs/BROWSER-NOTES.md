# Cross-Browser Compatibility Matrix

**Tested manually by the project owner on 2026-09-25**, against the live Vercel
deployment with a real microphone and a real phone on speaker. Versions were not
recorded at the time; the procedure is Task 12 Step 1 of
`docs/superpowers/plans/2026-09-22-aloud-implementation.md`.

## Test Procedure

Each row tests:
1. Greeting audible
2. Typed text spoken
3. Ledger match
4. Mic captions appear
5. Barge-in stops audio
6. Hangup deletes recording (confirmed on screen)

| Browser | Version | Greeting | Text Spoken | Ledger Match | Mic Captions | Barge-in Stops | Deletion Confirmed | Notes |
|---------|---------|----------|-------------|--------------|--------------|-----------------|--------------------|----|
| Chrome | not recorded | PASS | PASS | PASS | PASS | PASS | PASS | |
| Firefox | not recorded | PASS, with a caveat | PASS | PASS | PASS | PASS | PASS | **Stutter on the first call of a session, intermittently.** Not reproduced on subsequent calls in the same session. Cause not yet diagnosed — see below. |
| Safari | not recorded | PASS | PASS | PASS | PASS | PASS | PASS | |

## Firefox: the first-call stutter

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

**Impact on the submission: low.** It is intermittent, cosmetic, and clears on
its own. If the demo video is recorded in Chrome it will not appear at all. Worth
one timed experiment if the schedule allows; not worth risking the deadline.
