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

## Status

**Day one — documentation only.** No application code yet. Start with [`docs/superpowers/plans/2026-09-22-aloud-implementation.md`](docs/superpowers/plans/2026-09-22-aloud-implementation.md).

The design rests on five contract questions about AssemblyAI's custom-LLM path that are answered by measurement, not by reading — they are plan Task 5, and they run before any UI is built. Spec [§3.2](docs/superpowers/specs/2026-09-22-aloud-design.md) names each one and its fallback.

## Docs

| File | What it is |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Problem, user, features, out-of-scope, the originality argument |
| [`docs/superpowers/specs/2026-09-22-aloud-design.md`](docs/superpowers/specs/2026-09-22-aloud-design.md) | Architecture, the verbatim pass-through, retention, errors, testing |
| [`docs/superpowers/plans/2026-09-22-aloud-implementation.md`](docs/superpowers/plans/2026-09-22-aloud-implementation.md) | The build, task by task, with real code |
| [`docs/TASKS.md`](docs/TASKS.md) | The calendar to 2026-09-30 and the standing risks |
| [`docs/research/pitch-stats.md`](docs/research/pitch-stats.md) | Every number, sourced and dated |
| [`docs/research/hackathon-strategy.md`](docs/research/hackathon-strategy.md) | How judges score and what the field built |
| [`docs/assemblyai-integration.md`](docs/assemblyai-integration.md) | Verified AssemblyAI API reference (§10 = Voice Agent API) |

## A note on scope

Aloud is not an FCC-certified relay provider and does not claim to be. It is a working demonstration of a mechanism — verbatim by construction, with a receipt — that any certified provider could adopt, and that the regulation already requires of them.

It is also not written by someone who needs it. The open questions in [`docs/PRD.md`](docs/PRD.md) §10 say which decisions belong to someone who does, and the sharpest one is still open: **should software ever speak *for* you, or only ever say what you wrote?**

## Licence

MIT, as the default for a hackathon entry that judges must be able to read and run. Add the `LICENSE` file before the repo is made public.
