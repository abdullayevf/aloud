# Build plan — 8 days to deadline (2026-09-22 → 2026-09-30)

Companion docs: [`PRD.md`](PRD.md), [`superpowers/specs/2026-09-22-clinic-intake-voice-agent-design.md`](superpowers/specs/2026-09-22-clinic-intake-voice-agent-design.md), [`research/pitch-stats.md`](research/pitch-stats.md).

Submit with a day of margin — don't target the exact deadline. Aim to have a submittable state by end of Day 7 (9/28), use Day 8 as buffer.

## Day 1 — 9/22 (today): scaffold
- [ ] `git init`, initial commit with docs
- [ ] Create AssemblyAI account, get API key (free credits via the hackathon signup link)
- [ ] Scaffold Next.js app
- [ ] `/api/token` route — mints AssemblyAI Voice Agent token server-side, key never touches the client
- [ ] Minimal client page: connect to `wss://agents.assemblyai.com/v1/ws`, send bare `session.update`, confirm `session.ready` comes back

## Day 2 — 9/23: core conversation loop
- [ ] Mic capture (PCM16 24kHz, base64, `input.audio` events)
- [ ] Playback of `reply.audio` via Web Audio output buffer (no sleep-scheduling — see design doc §2/§4 gotcha)
- [ ] System prompt + greeting tuned for the clinic-intake persona
- [ ] End-to-end: speak, hear a coherent reply, in English first

## Day 3 — 9/24: structured extraction
- [ ] Wire `record_intake` and `flag_urgency` tool definitions into `session.update`
- [ ] Handle `tool.call` → resolve → `tool.result` after `reply.done` (discard on `interrupted`)
- [ ] Build the "intake card" UI component that fills in live from tool calls
- [ ] Urgency badge component driven by `flag_urgency`

## Day 4 — 9/25: multilingual demo path
- [ ] Confirm/select Spanish-capable voice via `GET /v1/voices` (design doc flags `lola` as unverified placeholder)
- [ ] Script and rehearse the Spanish-language demo call (this is the one path that must be flawless)
- [ ] Keyterms tuned (clinic name, insurance/seguro, referral/cita, etc.)
- [ ] Verify native code-switching behavior — no forced `language_code`

## Day 5 — 9/26: differentiators + resilience
- [ ] Resolve the diarization open question from the design doc — either get per-speaker labels working, or descope to a scripted double-voice demo beat
- [ ] ROI counter component (static math from `pitch-stats.md` constants: missed-call cost avoided, interpreter cost avoided)
- [ ] Reconnect handling (`session.resume` within 30s window)
- [ ] Barge-in handling (flush output buffer on `interrupted`)
- [ ] Explicit session termination on hangup/unload (billing hygiene)

## Day 6 — 9/27: deploy + harden
- [ ] Deploy to Vercel, confirm public application URL works end-to-end for a stranger (not just localhost)
- [ ] Run the three test passes from the design doc: scripted Spanish path, English fallback, one deliberate hard case (mumbling/noise)
- [ ] Fix whatever breaks under a cold, unrehearsed run

## Day 7 — 9/28: submission assets
- [ ] Record pitch video (≤5 min, MP4, ≤300MB) — structure: problem 0:00–0:30, demo 0:30–2:30, business case 2:30–4:00 (cite `pitch-stats.md`), team/roadmap 4:00–5:00
- [ ] Build slide deck (PDF)
- [ ] Cover image (PNG/JPG, 16:9)
- [ ] Write title (≤50 chars), short description (≤255 chars), long description (≥100 words), tech/category tags
- [ ] Push GitHub repo public, confirm commit history actually shows build progress (not one final dump commit — this was flagged as a fatal mistake in the hackathon-winning research)

## Day 8 — 9/29: buffer
- [ ] Fix anything the Day 6 hard-case testing surfaced
- [ ] Full run-through of the actual submission form against the deliverables checklist in `PRD.md` §6
- [ ] Submit

## Deadline — 9/30
Hard stop. Nothing scheduled here on purpose — if Day 8 buffer wasn't needed, this is slack.
