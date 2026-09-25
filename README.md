# Aloud

**A relay call with nobody else in it.**

You type. Your words are spoken aloud on the line — **verbatim**. The other person talks; you read it live. After every sentence, Aloud shows you what you typed beside what was actually said in your name, checked against the phone provider's own recording of its own voice.

Then the call ends, and that recording is deleted while you watch.

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon), September 2026.

---

## Why

Federal law has promised since 1990 that relay would be *"functionally equivalent"* to a phone call (47 U.S.C. § 225(a)(3)). Here is what is actually funded, per minute, for the year beginning July 2026:

| If you… | you get | the TRS Fund pays |
|---|---|---|
| sign | a human interpreter in your video call | **$4.35 – $8.61** |
| type | a human operator reading your words out | **$2.2710** |
| have a speech disability | a human operator repeating you | **$10.3023** |
| can speak, but not hear | machine captions of the other party | **$0.95** |

The automated tier stops at the deaf user's ear. Machines are trusted to carry words *into* the call. Carrying words *out* of it still costs a person — and the most expensive line in the whole $1.56 billion program is the one for people who cannot speak.

> **"We just go right to the hospital. I wouldn't call my doctor at all. I just go right to the emergency room."**
> — a participant in Steinberg et al., *Journal of General Internal Medicine*, 2006

Sources, dates and the prior art that already exists: [`docs/research/pitch-stats.md`](docs/research/pitch-stats.md).

## What's actually new here

Type-to-speak with live captions **already ships** in the United States. InnoCaption added it in March 2026; Rylo offers it too. We say that first, because the thing this project is not is a discovery.

What no one ships is the proof.

One of those products advertises **rewriting your words** before speaking them — "AI Refine" turns `make appointment` into a full sentence you did not write. Federal law prohibits a relay operator from *intentionally altering a relayed conversation* (47 U.S.C. § 225(d)(1)(G)).

So Aloud does not ask a language model to behave. It **removes the model from the path.** The agent's LLM is our own endpoint, and in verbatim mode it runs no inference at all — it streams back exactly the characters you typed. Then it shows you the receipt.

## How it works

The AssemblyAI Voice Agent API is built for an AI to talk to a human. Aloud swaps the two roles:

| The API's idea | What it actually is here |
|---|---|
| the "user" speaking into the mic | **the hearing party** → your live captions |
| the "agent" replying | **your typed words**, spoken aloud |

```
you type ─► browser ─► AssemblyAI ─► POST /api/llm/v1/chat/completions (ours)
                                     └─► streams your text back, unmodified
                     AssemblyAI TTS ─► speaks it
                     transcript.agent ─► the receipt ─► the ledger diffs it
```

One socket. One provider. No database. On hangup, `DELETE /v1/sessions/{id}`.

## Measured latency

`reply.create` → first `reply.audio`, measured 2026-09-25 against `https://aloud-implementation.vercel.app` with `node scripts/gate-probe.mjs` (gate G3), three turns in one session: **377 ms, 331 ms, 238 ms · mean 315 ms**. That is a per-turn figure from three samples, not a benchmark, and it is the full round trip — it **includes AssemblyAI's own speech synthesis**, not just our hop. Two other numbers feed into it and are not the same thing: our endpoint's own turnaround was measured separately at **~29 ms** (2026-09-23, `docs/research/gate-results-2026-09-22.md`), and the browser adds `MIN_LEAD_SECONDS`, a deliberate **120 ms** scheduling lead (`lib/audio/playback.ts`) — without it, the first several audio frames get scheduled into the past and stack into one garbled burst. Do not quote 315 ms as "our latency" without saying what's inside it.

## Inspiration: Caption with Intention

The word-by-word ink on the caption line borrows its grammar from [Caption with Intention](https://www.captionwithintention.org/) (Chicago Hearing Society, a RAISE partner of the Academy) — a **human-authored, deliberately non-automated** system for post-produced film, where a captioner maps colour to speaker, animation to delivery, font size to volume, font weight to pitch. Aloud drives the same visual grammar from live machine signal instead of a captioner's judgment, and implements **only the channel it can measure**: the word timings the provider's own transcript carries, so the stroke crosses each word in the time the voice actually takes over it. (An amplitude strip drawn from our own microphone was built and then deleted on 2026-09-26 — it restated in motion what the turn label already said in words.) Pitch and emotion are deliberately absent — rendering inferred feeling would put emotion into the hearing party's mouth, the mirror image of rewriting the user's words. Credited as inspiration; Aloud is not affiliated with Caption with Intention and does not claim or imply its endorsement.

## Status

**Built and deployed.** Tasks 1–13 of the [implementation plan](docs/superpowers/plans/2026-09-22-aloud-implementation.md) are done — browser audio, the verbatim pass-through, the ledger, the relay client, the call screen and the deletion-on-hangup path — and the app is live at `https://aloud-implementation.vercel.app`.

The design rested on five contract questions about AssemblyAI's custom-LLM path that could only be answered by measurement, not by reading. **All five are closed**, measured 2026-09-22/23 against a real deployment; spec [§3.2](docs/superpowers/specs/2026-09-22-aloud-design.md) names each one and the evidence is in [`docs/research/gate-results-2026-09-22.md`](docs/research/gate-results-2026-09-22.md). Re-run them any time with `node scripts/gate-probe.mjs https://<deployment>`.

Two things are outstanding, and neither is something code can finish:

- **The cross-browser matrix is not filled in.** Every cell in [`docs/BROWSER-NOTES.md`](docs/BROWSER-NOTES.md) still reads PENDING. Chrome, Firefox and Safari each need a human with a real browser and a real microphone to walk the six checks; no browser has been manually verified.
- **The submission video is not recorded.** [`docs/SUBMISSION.md`](docs/SUBMISSION.md) carries the finished script and shot list, plus the submission copy. No video file exists.

## Docs

| File | What it is |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Problem, user, features, out-of-scope, the originality argument |
| [`docs/superpowers/specs/2026-09-22-aloud-design.md`](docs/superpowers/specs/2026-09-22-aloud-design.md) | Architecture, the verbatim pass-through, retention, errors, testing |
| [`docs/superpowers/plans/2026-09-22-aloud-implementation.md`](docs/superpowers/plans/2026-09-22-aloud-implementation.md) | The build, task by task, with real code |
| [`docs/TASKS.md`](docs/TASKS.md) | The calendar to 2026-09-30 and the standing risks |
| [`docs/SUBMISSION.md`](docs/SUBMISSION.md) | Submission copy, sourced format limits, and the video script (not yet recorded) |
| [`docs/BROWSER-NOTES.md`](docs/BROWSER-NOTES.md) | Cross-browser verification matrix — awaiting a human tester |
| [`docs/research/pitch-stats.md`](docs/research/pitch-stats.md) | Every number, sourced and dated |
| [`docs/research/hackathon-strategy.md`](docs/research/hackathon-strategy.md) | How judges score and what the field built |
| [`docs/assemblyai-integration.md`](docs/assemblyai-integration.md) | Verified AssemblyAI API reference (§10 = Voice Agent API) |

## A note on scope

Aloud is not an FCC-certified relay provider and does not claim to be. It is a working demonstration of a mechanism — verbatim by construction, with a receipt — that any certified provider could adopt, and that the regulation already requires of them.

It is also not written by someone who needs it. The open questions in [`docs/PRD.md`](docs/PRD.md) §10 say which decisions belong to someone who does, and the sharpest one is still open: **should software ever speak *for* you, or only ever say what you wrote?**

## Licence

[MIT](LICENSE), the default for a hackathon entry that judges must be able to read and run.
