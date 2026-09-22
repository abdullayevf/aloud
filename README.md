# Intake Copilot *(working name — see `docs/research/naming.md`)*

A multilingual voice agent that answers the phone at small, under-resourced clinics, conducts patient intake in the caller's own language, extracts structured intake data live, and flags urgency for triage — built on [AssemblyAI's Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api).

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon) (lablab.ai × AssemblyAI, Sept 1–30 2026).

## The problem

US medical practices miss 23–42% of inbound calls, losing $200K–500K/year on average. For the 25M limited-English-proficient patients in the US, it's worse: clinics either can't serve the call, or pay $1.25–4/min for a human interpreter. Full sourcing in [`docs/research/pitch-stats.md`](docs/research/pitch-stats.md).

## What it does

- Answers a simulated clinic line (browser mic demo — see `docs/PRD.md` §5 for why not real telephony)
- Conducts intake in whatever language the caller speaks, natively code-switching
- Extracts structured intake data live (name, DOB, reason for visit, insurance, callback number) into a visible "intake card"
- Flags urgency (routine / same-day / urgent) for triage
- Frames the compliance story: AssemblyAI is a HIPAA business associate for PHI processing

## Docs

- [`docs/PRD.md`](docs/PRD.md) — product requirements, target user, feature list, submission checklist
- [`docs/superpowers/specs/2026-09-22-clinic-intake-voice-agent-design.md`](docs/superpowers/specs/2026-09-22-clinic-intake-voice-agent-design.md) — technical architecture
- [`docs/TASKS.md`](docs/TASKS.md) — day-by-day build plan
- [`docs/research/`](docs/research/) — pitch stats, naming candidates, hackathon strategy research
- [`CLAUDE.md`](CLAUDE.md) — AssemblyAI API integration reference for anyone (or any agent) building in this repo

## Status

In development for the Sept 30, 2026 deadline. See `docs/TASKS.md` for current progress.

## Stack

Next.js, deployed on Vercel, using AssemblyAI's Voice Agent API (`wss://agents.assemblyai.com/v1/ws`) for the full speech-in/speech-out pipeline.
