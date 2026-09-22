# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Aloud** — a relay that lets a deaf, hard-of-hearing or non-speaking person place an ordinary phone call without a stranger in it. They type; their words are spoken aloud **verbatim**. The other party talks; it is captioned live. Every utterance shows what was typed beside what was actually said in their name, checked against the provider's own record. When the call ends, the provider's recording is deleted and the user watches it happen.

Built for the **AssemblyAI Voice Agent Hackathon** (lablab.ai × AssemblyAI, 1–30 September 2026), deadline **2026-09-30**.

**Read these first, in order:**

1. [`docs/PRD.md`](docs/PRD.md) — problem, target user, MVP features, out-of-scope, the originality argument (§7 leads with prior art, deliberately), submission checklist, open questions
2. [`docs/superpowers/specs/2026-09-22-aloud-design.md`](docs/superpowers/specs/2026-09-22-aloud-design.md) — architecture, the verbatim pass-through and its **five validation gates**, retention, error handling, browser audio, testing. **§0 lists what was deleted from this repo and must not come back.**
3. [`docs/superpowers/plans/2026-09-22-aloud-implementation.md`](docs/superpowers/plans/2026-09-22-aloud-implementation.md) — exact files, real code, commands and expected output, task by task. This is what you execute.
4. [`docs/TASKS.md`](docs/TASKS.md) — the calendar and the standing risks
5. [`docs/research/pitch-stats.md`](docs/research/pitch-stats.md) — every number with a source and a date. **Read §0 before writing any originality claim.**
6. [`docs/research/hackathon-strategy.md`](docs/research/hackathon-strategy.md) — how judges score, what AssemblyAI rewards, the measured field

**AssemblyAI integration reference:** [`docs/assemblyai-integration.md`](docs/assemblyai-integration.md) — §10 is a **verified 2026-09-22 snapshot** of the Voice Agent API (auth, session schema, events, tools, browser audio, sessions and recordings, error codes, billing). Every page under `/docs/voice-agents/voice-agent-api/` serves raw Markdown if you append `.md` to the URL — fetch that rather than scraping the rendered page. Do not re-research what §10 already covers; re-verify before relying on anything, because this product moves fast.

## Status / stack

Docs-only as of 2026-09-22 (day one). Planned stack: **Next.js 15 (App Router) + TypeScript (strict) + Tailwind + Vitest, deployed on Vercel.**

- `POST /api/call` ensures the stored agent exists and mints a short-lived Voice Agent token — the only place the real API key is touched.
- `POST /api/llm/v1/chat/completions` is **our own OpenAI-compatible endpoint**, registered as the agent's `llm`. In verbatim mode it runs no model and echoes the typed text. This is the product.
- `POST /api/end` calls `DELETE /v1/sessions/{id}` on hangup.
- The browser connects directly to `wss://agents.assemblyai.com/v1/ws?token=…`; no audio is proxied through the server.
- **No datastore.** UI state is client-side and dies with the page.

Replace this section with real dev/build/lint/test commands once the app is scaffolded (implementation plan Task 1).

## Architecture (planned)

```
Browser: types ▸ ledger (typed | spoken) ▸ live captions ▸ mic in / speaker out
   │ ① POST /api/call            → { token, agentId }
   │ ② wss://agents.assemblyai.com/v1/ws?token=…   base64 PCM16 mono 24 kHz in JSON
   │ ⑥ POST /api/end             → DELETE /v1/sessions/{id}
   ▼
Next.js on Vercel
   ├─ /api/call                      stored agent + token; holds the API key
   ├─ /api/llm/v1/chat/completions   ③ AssemblyAI calls THIS for every reply
   │                                 ④ verbatim: echo · assistant: proxy LLM Gateway
   └─ /api/end                       ⑤ deletes the provider's recording
```

**The inversion:** the API's "user" is the **hearing party** (captioned); the API's "agent" is the **deaf user's typed words** (spoken). One socket, both directions.

## Key decisions (settled — don't re-litigate without new information)

- **Verbatim is built, not prompted.** No model is asked to repeat the user's words; in verbatim mode no model runs at all. If anything ever routes typed text through an LLM "to tidy it up", the product's central claim is void. Spec §3.4.
- **`llm` is a stored-agent field only.** It is not in the inline `session.update` schema. So the browser always connects with `{"agent_id": …}` as the first and only config message. `agent_id` beside any inline field raises `agent_id_not_first`.
- **`base_url` must be public HTTPS.** Loopback and private hosts are rejected. There is no localhost-only phase; deploy on day one.
- **The text travels in band**, wrapped in a `\u0001SAY\u0001` / `\u0001ASSIST\u0001` sentinel, through AssemblyAI, and arrives in the chat-completions request body. That keeps the server stateless and holds no call content. **This depends on gate G1** (spec §3.2); the fallback is a per-call agent with a delete-on-read store.
- **The recording is deleted, not harvested.** `DELETE /v1/sessions/{id}` on hangup, shown on screen. The previous product in this repo built a post-call packet out of the recording; that is dead and must not return.
- **Assistant mode is navigation only**, off by default, never self-enabling, and it never speaks in the user's name or answers for them. It exists because IVR menus are a documented barrier. If someone with lived experience says it should not exist, delete it.
- **No tools.** Aloud declares `tools: []`. UI state comes from transcript events.
- **`turn_detection` deliberately unset** — setting `min_silence`/`max_silence` disables adaptive pacing and entity-aware waiting for the whole session.
- **`input.language_codes` deliberately omitted** — the hearing party may speak any of the 18 recognised languages.
- **`transcription_mode: "balanced"`** — the captions are the accessibility surface; late captions are a defect. Do not raise it without measuring.
- **Voice `jane`, and it is the user's choice.** `output.voice` is immutable per session, so it is chosen before dialling.
- **Session termination is `session.end` → `session.ended`**, never `{"type":"Terminate"}` (that is realtime STT). Closing the socket bare leaves a **billable** 30-second grace window.
- **Browser demo, not real telephony.** Inbound SIP needs a funded Twilio number judges cannot dial, and only the browser gives free acoustic echo cancellation.

## Honesty rules for this repo

These exist because the previous product died of a false originality claim.

- **Type-to-speak with live captions already ships** — InnoCaption (March 2026) and Rylo, both FCC-funded. Never claim this category is empty. See `docs/research/pitch-stats.md` §0 and §4.
- **Every number gets a source and a date.** If it cannot be sourced, it does not get written. If a source is an aggregator, say so and flag it.
- **Label confidence.** "Verified against X on DATE" or "UNVERIFIED, needs checking". No bare assertions.
- **The word "deleted" is precise.** `DELETE /v1/sessions/{id}` is a documented soft delete. Never write "erased" or "destroyed".
- **Agency first.** The copy is about someone being heard, not about the software helping them. If a sentence congratulates the product for caring, rewrite it.

## Gotchas that will cost you an afternoon

- Never `new AudioContext({ sampleRate: 24000 })`. Firefox honours it and silently loses echo cancellation (the agent then interrupts itself every reply); Safari ignores it and silently garbles the audio. Resample inside the worklet instead.
- `input.audio` carries audio in `audio`; `reply.audio` carries it in **`data`**.
- `transcript.user.delta.text` is the **full transcript so far** — replace, never concatenate.
- On barge-in, `stop()` the already-scheduled `AudioBufferSourceNode`s. Resetting the playback cursor alone leaves stale audio playing — on a relay that means unauthorised words still coming out of the phone.
- `expires_in_seconds` is **required** on the token endpoint, and tokens are single-use — mint a fresh one per connection, including every resume.
- `Bearer` prefix on `agents.assemblyai.com`; **no** prefix on `api.assemblyai.com`.
- The Sessions API **omits** empty arrays — a session with no speech has no `turns` key at all. Default them when reading.
- `session.ready.config` echoes the full resolved configuration. Log it; it is the cheapest way to see what the server actually accepted.
- `session_expired` closes the socket with **no warning event first**. Run your own client-side timer.
- In browsers, a pre-handshake failure surfaces only as close code **1006** with nothing readable.
- LLM Gateway is **excluded** from the $50 of free AssemblyAI credits. Verbatim mode costs nothing extra; assistant mode bills from the first request.
