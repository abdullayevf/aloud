# Design: Multilingual Clinic Intake & Triage Voice Agent

**Date:** 2026-09-22
**Companion doc:** [`docs/PRD.md`](../../PRD.md) (product requirements), [`docs/research/pitch-stats.md`](../../research/pitch-stats.md) (sourcing)
**Deadline:** 2026-09-30 (8 days from spec date)

## 1. Architecture overview

```
Browser (mic in / speaker out)
   │  WebSocket (wss://agents.assemblyai.com/v1/ws)
   │  audio: base64 PCM16 mono 24kHz, JSON events
   ▼
Next.js app
   ├─ /api/token   (server route — mints short-lived AssemblyAI token,
   │                 the ONLY place the real API key is touched)
   ├─ client page  (connects directly to AssemblyAI with the temp token,
   │                 per AssemblyAI's browser pattern — no audio proxied
   │                 through our server)
   └─ UI components:
        - live transcript / conversation view
        - "intake card" (fills in from tool-call results)
        - urgency badge
        - ROI counter (client-side math from static stats table)
```

This follows the Voice Agent API path (Section 10 of the AssemblyAI integration instructions), not raw realtime STT + custom LLM/TTS — chosen for build speed inside the remaining window: one managed WebSocket handles STT + LLM + TTS + turn-taking + tool-calling.

**Why not Twilio/SIP for real telephony:** out of scope per PRD §5. Real inbound calling adds a second failure-prone integration surface (carrier setup, webhook plumbing, audio encoding mismatches) for a feature judges don't need — the submission requirement is an interactive app URL, which a browser demo satisfies directly.

## 2. AssemblyAI session configuration

Voice Agent API `session.update` payload (sketch, values to refine during build):

```json
{
  "type": "session.update",
  "session": {
    "system_prompt": "You are an intake assistant answering the phone at [clinic name], a community clinic. Greet callers, conduct intake in whatever language they speak (code-switch naturally), and use the record_intake and flag_urgency tools as you learn information. Be warm and efficient — this is often a stressed caller.",
    "greeting": "Hi there — you've reached [clinic name]. How can I help you today? / Hola, ha llamado a [clinic name]. ¿En qué puedo ayudarle?",
    "input": {
      "format": { "encoding": "audio/pcm" },
      "keyterms": ["[clinic name]", "insurance", "seguro", "referral", "cita"]
    },
    "output": {
      "voice": "lola",
      "format": { "encoding": "audio/pcm" }
    },
    "tools": [
      {
        "type": "function",
        "name": "record_intake",
        "description": "Record or update a field of the patient's intake information.",
        "parameters": {
          "type": "object",
          "properties": {
            "field": { "type": "string", "enum": ["name", "dob", "reason_for_visit", "insurance", "callback_number"] },
            "value": { "type": "string" }
          },
          "required": ["field", "value"]
        }
      },
      {
        "type": "function",
        "name": "flag_urgency",
        "description": "Set the triage urgency tier once enough is known about the reason for the call.",
        "parameters": {
          "type": "object",
          "properties": {
            "tier": { "type": "string", "enum": ["routine", "same_day", "urgent"] },
            "reason": { "type": "string" }
          },
          "required": ["tier"]
        }
      }
    ]
  }
}
```

Open item to verify against live docs before build (per the integration instructions' Operating Rule 12 — parameters move between beta/GA): confirm `lola` (Spanish-native voice) is still a valid voice ID via `GET /v1/voices`, and confirm current tool-calling event shape (`tool.call` → accumulate → `tool.result` after `reply.done`, discard on `status: "interrupted"`).

**Diarization — RESOLVED (checked 2026-09-22):** confirmed against the official [session configuration reference](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/session-configuration) — the Voice Agent API's `session.update` schema has **no `speaker_labels` / diarization field**. That parameter only exists on raw realtime STT (Section 9 of the integration instructions), which is a different WebSocket entirely. Getting real diarization would mean running a second, parallel realtime-STT connection alongside the managed agent just to label the companion speaker — real added complexity for a demo-day nice-to-have.

**Decision:** descope live diarization. Feature 4 in the PRD becomes a *scripted* demo beat instead (a second voice/actor speaks a line, the agent visibly handles the interjection gracefully) rather than a system that actually labels speakers. PRD §4 and §8 updated to reflect this — not a live technical claim anymore.

## 3. Data flow

1. Client loads page → requests token from `/api/token` (server holds the real key, mints via `GET https://agents.assemblyai.com/v1/token`).
2. Client opens WebSocket to `wss://agents.assemblyai.com/v1/ws?token=...`, sends `session.update` immediately.
3. On `session.ready`, client starts streaming mic audio as `input.audio` events.
4. Server emits `transcript.user`/`transcript.user.delta` (rendered as live transcript), `tool.call` events (client resolves against a local intake-state object and sends `tool.result`), `reply.audio` (played via an OS/Web Audio output buffer, not sleep-scheduled — per the gotcha in the integration doc), `transcript.agent`.
5. UI derives the "intake card" and urgency badge purely from accumulated `record_intake` / `flag_urgency` tool calls — no separate backend state needed for the demo.
6. ROI counter is static client-side math (missed-call-cost-avoided + interpreter-cost-avoided constants from `pitch-stats.md`), incremented once the call completes — not a real analytics pipeline.

## 4. Error handling

- Token mint failure → show a retry button, don't silently fail.
- WebSocket drop mid-call → attempt `session.resume` within the 30s window per the AssemblyAI reconnect pattern; past that, restart a fresh session and preserve whatever intake fields were already captured client-side.
- `reply.done.status == "interrupted"` (barge-in) → flush audio output buffer immediately (per known gotcha), discard any pending unresolved tool call from that turn.
- Always send `{"type": "Terminate"}`-equivalent session close on page unload/hangup button — an abandoned session keeps billing.

## 5. Testing approach

Given the 8-day window, this is demo-correctness testing, not a full test suite:

- Manual scripted run-through of the Spanish-language demo path (the one path that must work flawlessly on stage/in the video).
- Manual run-through of an English fallback path (in case a judge tries the live app URL themselves).
- One deliberate "hard case" — mumbled short answer, background noise — to show the agent doesn't break, since judges may poke at the live URL.
- No automated test suite planned for v1 given the timeline; flag if that's wrong and testing should be added.

## 6. Open questions carried from PRD

See `docs/PRD.md` §8 — team size, demo shape confirmation, working name, target state. Diarization (previously open) is now resolved — see §2 above.
