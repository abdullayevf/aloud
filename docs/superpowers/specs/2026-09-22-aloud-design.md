# Aloud — design spec

**Date:** 2026-09-22
**Status:** v1. Written on day one of the build, immediately after abandoning the previous product in this repo.
**Product requirements:** [`docs/PRD.md`](../../PRD.md)
**Verified API reference:** [`docs/assemblyai-integration.md`](../../assemblyai-integration.md) §10 — auth, the full `session.update` schema, mutability, the event list, tool schemas, browser audio, error codes, billing. **This spec does not restate it.** Read §10 first; everything here assumes it.

---

## 0. What changed and why — do not re-litigate

This repo previously specified a multilingual clinic-intake and triage voice agent. It was abandoned on 2026-09-22 with no application code written, because its originality claim was false, its compliance feature rested on a marketing page, and its multilingual claim overreached. The full account is in [`docs/PRD.md`](../../PRD.md) §9.

Three things that spec asserted are **dead and must not reappear**:

1. **The post-call packet.** It built a downloadable artifact out of the session recording. Aloud does the opposite: it **deletes** the recording at hangup (§5). If you find yourself designing a transcript export, stop and read §5.
2. **In-session PII redaction.** It does not exist on the Voice Agent API. It never did.
3. **Tool-call-driven UI state.** Aloud's UI state comes from transcript events and its own server, not from function tools. Aloud declares **no tools at all** in v1.

One thing carries over intact: the **browser audio pipeline** (§7). It is product-neutral and the constraints in it are real.

---

## 1. The idea in one paragraph

The AssemblyAI Voice Agent API assumes an AI agent talks to a human. Aloud swaps the roles: the API's "user" is the **hearing party** (captioned live) and the API's "agent" is the **deaf user's typed words** (spoken aloud). To guarantee the typed words are spoken unaltered — a legal duty, not a preference — Aloud registers **its own OpenAI-compatible endpoint** as the agent's LLM, and in verbatim mode that endpoint does no inference: it echoes. `transcript.agent` comes back as a receipt, and the screen shows typed against spoken.

---

## 2. Architecture

```
┌── the deaf user's browser ──────────────────────────────────────────┐
│  types ▸ [ ledger: typed | spoken ✓ ]  ▸ live captions of the line  │
│  mic in (the room / the far end)     speaker out (TTS of the typed) │
└──────┬──────────────────────────────────────────────┬───────────────┘
       │ ① POST /api/call     (mint token, ensure agent)│
       │ ③ WS wss://agents.assemblyai.com/v1/ws?token=… │ ⑥ POST /api/end
       ▼                                                ▼
┌── Next.js on Vercel ────────────────────────────────────────────────┐
│  /api/call            creates/reuses the stored agent, mints token  │
│  /api/llm/v1/chat/completions   ← ② AssemblyAI calls THIS, per reply│
│                        verbatim: echo   ·  assistant: proxy gateway │
│  /api/end             DELETE /v1/sessions/{id}   (+ agent cleanup)  │
└─────────────────────────────────────────────────────────────────────┘
       ▲                                                │
       │ ④ POST {base_url}/chat/completions (streaming) │ ⑤ speaks it
       └──────────── AssemblyAI Voice Agent ────────────┘
```

Audio never touches our server. The API key never reaches the browser. There is no database.

### 2.1 Why a stored agent

`llm` is a **stored-agent field only** — it is not in the inline `session.update` schema (integration §10, Custom LLM). So Aloud must use a stored agent and connect with `{"type":"session.update","session":{"agent_id":"<id>"}}` as the first and only config message. `agent_id` is mutually exclusive with every inline field; sending both raises `agent_id_not_first`.

Stored-agent REST, verified 2026-09-22 against [manage-agents.md](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/manage-agents.md):

| Method | Path | Returns |
|---|---|---|
| POST | `/v1/agents` | 201, the agent object with a generated `id` |
| GET | `/v1/agents` | 200, lightweight list (`id`, `name`, timestamps) |
| GET/PUT | `/v1/agents/{id}` | 200 |
| DELETE | `/v1/agents/{id}` | 204 |

Auth is `Authorization: <API_KEY>`; a `Bearer ` prefix is accepted and stripped on `agents.assemblyai.com` REST. `llm.api_key` is write-only and never returned.

### 2.2 Agent configuration

```jsonc
{
  "name": "aloud-relay",
  "greeting": "Hello. You're on a relay call. The person you're speaking with types, and I read what they type out loud. Please speak normally.",
  "system_prompt": "<see §4.4 — only reachable in assistant mode>",
  "voice": { "voice_id": "jane" },
  "input": {
    "format": { "encoding": "audio/pcm" },
    "transcription_mode": "balanced",
    "voice_focus": "far-field"
  },
  "output": { "format": { "encoding": "audio/pcm" }, "volume": 100 },
  "tools": [],
  "llm": [{
    "base_url": "https://<deployment-host>/api/llm/v1",
    "model": "aloud-verbatim",
    "api_key": "<ALOUD_LLM_SHARED_SECRET>"
  }]
}
```

Choices, with reasons:

- **`greeting`** is the relay announcement. It is the one string in the whole API that goes straight to TTS without passing through a model — verbatim **by documentation**. It is also immutable after `session.ready`, which is fine: it is the same sentence every call. It exists because deaf users get hung up on (pitch-stats §5).
- **`voice: jane`** — a US English voice from the verified list. `output.voice` is immutable for the session, so it is chosen once. This is a **product decision the user should make**: the synthetic voice is the user's voice on that call. See §11.
- **`transcription_mode: "balanced"`** — the default. The previous product forced `max_accuracy` because it was capturing dates of birth. Here the transcribed thing is the *other party's* conversation, and captions that arrive late are an accessibility defect. Do not raise it without measuring.
- **`voice_focus: "far-field"`** — the demo's hearing party is a speakerphone in the room, not a headset.
- **`input.language_codes` omitted** — automatic detection and native code-switching. The hearing party may not speak English.
- **`turn_detection` unset** — setting `min_silence`/`max_silence` disables adaptive pacing and entity-aware waiting for the whole session. Leave it alone.
- **`tools: []`** — Aloud has no tools. The UI is driven by transcript events and its own server.

### 2.3 Agent lifecycle

**One stored agent, created on first use and reused.** Settled: G1 (§3.2) passed, so no per-call correlation is needed and the per-call-agent variant is not built.

One caveat carried over from the gate runs and **still open**: an agent created from Vercel's network was invisible to REST and WebSocket calls from another network for 30+ minutes. Real users connect from outside Vercel's network too, so `/api/call` must treat `agent_not_found` as recoverable — recreate rather than reuse — instead of assuming the stored agent resolves everywhere (§8).

---

## 3. Verbatim, and how the words actually travel

### 3.1 The pass-through

AssemblyAI calls `POST {base_url}/chat/completions` for **every reply**, with streaming required. Our handler, in verbatim mode, streams back OpenAI-shaped chunks whose content is exactly the user's typed text, then `[DONE]`. No model is consulted. There is nothing in the path that *can* paraphrase.

The user's typed text reaches that handler by travelling **in band**, through AssemblyAI, in the request AssemblyAI makes to us:

```
user types ──► browser sends over the WebSocket, as ONE message:
                 { "type": "reply.create",
                   "instructions": "\u0001SAY\u0001<the typed text>\u0001END\u0001" }
            ──► AssemblyAI POSTs our /api/llm/v1/chat/completions
                 with that text as the LAST `messages` entry, role "system"
            ──► we find the sentinel, strip it, stream the remainder back
            ──► TTS speaks it
            ──► transcript.agent returns → the ledger diffs it
```

This is the design that makes the server **stateless**: no pending-utterance store, no correlation problem, nothing about the call's content held anywhere on our side.

**Measured 2026-09-22** (G1 re-probe, [`docs/research/gate-results-2026-09-22.md`](../../research/gate-results-2026-09-22.md)): the text arrives **byte-identical** — verified against em dashes, typographic quotes, currency symbols, newlines and tabs, astral-plane emoji, and a 917-character utterance — and the arrival is **one-shot**, present in its own turn's request body and gone from the next. That is what removes the queue: a request either carries an utterance to speak or it does not, so an utterance cannot be dropped, duplicated or re-spoken by this mechanism.

Two mechanisms were measured and rejected. `conversation.message`, which earlier drafts of this spec specified, never reaches a custom LLM's request body at all — it is documented in the prose events reference and absent from the machine-readable API contract. Mutating `system_prompt` mid-session does deliver, but the text is sticky across turns and it destroys the stored agent's prompt.

### 3.2 Validation gates — run these before building on any of it

Each is a contract question answerable in one sitting with an API key. **All five are now closed** — measured 2026-09-22 and 2026-09-23, results in the table below and full evidence in [`docs/research/gate-results-2026-09-22.md`](../../research/gate-results-2026-09-22.md). The questions are kept as written, unedited, so the record shows what was asked before the answers were known. Re-run them with `node scripts/gate-probe.mjs https://<deployment>` after any change to the agent config or the pass-through.

#### What a reference implementation already settles (read 2026-09-22)

AssemblyAI's own BYO-LLM demo server — [`dan-ince-aai/voice-agent-byo-llm-demo`](https://github.com/dan-ince-aai/voice-agent-byo-llm-demo), `server.mjs` — is a working custom-LLM endpoint written by an AssemblyAI engineer. Reading it collapses most of G1 from a guess to a documented convention. Verified against that source, not inferred:

| Contract detail | What the reference implementation shows |
|---|---|
| **Path** | The server routes `POST /v1/chat/completions` and publishes ``base_url = `${TUNNEL}/v1` ``. So the agent calls **`{base_url}/chat/completions`** and `base_url` conventionally **ends in `/v1`**, exactly like the docs' `https://api.openai.com/v1` example. **This corrected a 404 in an earlier draft of this spec**, where `base_url` omitted `/v1` while the route included it. |
| **Body carries the conversation** | Header comment: *"It sends the conversation as OpenAI chat completions and reads back streamed tokens, so anything that answers in that shape is a valid model."* The handler reads `body.messages`, searching it for the last `role: "user"` and the last `role: "assistant"`. |
| **Message roles present** | `user`, `assistant`, and `tool`, plus `tool_calls` on assistant messages. |
| **`content` may not be a string** | Its `textOf()` helper handles `content` as a string **or** as an array of parts with `.text`. Our handler must do the same or it will silently miss the sentinel. |
| **`model` and `stream`** | `body.model` is the name the agent was published with; `body.stream !== false` is the streaming test. |
| **Auth header** | `req.headers.authorization || req.headers['x-api-key']`, with a `Bearer ` prefix stripped. The author hedges across both header names, so we accept both. |
| **Response shape** | `{ id, object: "chat.completion.chunk", created, model, choices: [{ index, delta, finish_reason }] }`, an opening `{role:"assistant", content:""}` delta, content deltas, a `finish_reason: "stop"` delta, then `data: [DONE]`. Identical to §3.1's design. |

**This is a reference implementation, not a specification.** It is strong evidence about conventions, and it is still not a promise from the vendor. G1 stays on the list; what remains of it is narrower.

| | Question | Decided fallback if it fails |
|---|---|---|
| **G1** ✅ **closed** | Does caller-supplied text reach our endpoint's request body byte-identical, and is the agent's `system_prompt` included as a system message (which assistant mode §4.2 relies on when it proxies)? **Both yes**, via `reply.create { instructions }` — see §3.1 and the re-probe evidence. `conversation.message`, the mechanism this gate was originally written against, does not work and is gone from the design. | ~~Path B~~ **not needed and not built.** It was: a per-call stored agent whose `base_url` carries a unique path segment, plus a 60-second delete-on-read store. Recorded here only so nobody re-derives it — the captured headers carry no session identifier, so Path B would genuinely have required a per-call agent to correlate. |
| **G2** ✅ **closed — it stays silent** | Is an **empty** assistant message accepted when nothing is pending — i.e. can the agent stay silent when the hearing party speaks? The reference implementation above always returns *something*, so it offers no evidence either way. Its opening `{role:"assistant", content:""}` delta is accepted, which is weak evidence that empty content parses; it says nothing about whether a reply with **only** empty content is tolerated or is spoken as an awkward pause. | Return a single space. If TTS still vocalises, set `output.volume: 0` (mutable) for suppressed turns and restore it before a real one. If neither holds, **Path C**. |
| **G3** | Added latency of the extra hop, measured against the managed model. | Expected *lower* in verbatim mode — we return immediately, with no inference. If it is not, profile before redesigning. |
| **G4** | Does `transcript.agent.text` reproduce the streamed text closely enough to diff, or does TTS normalisation alter it (numbers, punctuation, casing)? | Normalise both sides before comparison (§3.3) and show the raw pair on demand. A mismatch that is purely normalisation must not read as an alteration. |
| **G5** | Does `DELETE /v1/sessions/{id}` succeed immediately after `session.ended`, or must artifacts exist first? | Retry with backoff for up to 10 s, then surface the failure honestly (§5.3). |

~~**Path C, the last resort:**~~ one session per utterance, using `greeting`. **Not needed — G1 and G2 both passed.** Recorded so it is not re-derived: it was rejected as the primary because the reconnect gap drops the hearing party's speech, and a deaf spot in the captions is an accessibility defect.

#### Gate results, measured 2026-09-22

Run against the live deployment (`https://aloud-implementation.vercel.app`) with real AssemblyAI WebSocket sessions. `scripts/gate-probe.mjs` (committed) covers **G1, G3 and G4** in its default mode, and **G2** via its `--idle` flag; **G5** (`DELETE /v1/sessions/{id}` → 204) was verified separately, via a one-off script/curl-equivalent that is not part of the committed probe — `scripts/gate-probe.mjs` itself makes no `/v1/sessions/` call at all (only a `/v1/agents/{id}` delete, to clean up its own throwaway test agent). Full run transcripts, request-body log excerpts and the network-partition diagnostic trail are in the tracked file [`docs/research/gate-results-2026-09-22.md`](../../research/gate-results-2026-09-22.md) (the original Task 5 report lived under `.superpowers/sdd/`, which is gitignored and deleted at the end of the SDD process, so its evidence was moved here to keep the citation from dangling).

**A gap surfaced by that investigation, now closed:** `pendingUtterance()` could silently drop an utterance if two were typed before the agent replied to the first. It required no queue in the end. `reply.create { instructions }` carries the text *with* its own trigger and arrives one-shot, so each request carries exactly the utterance it is meant to speak. The function is now a scan for the sentinel from the end of `messages`, and the drop cannot occur.

**Environment note (not one of the five gates, but blocking without a workaround):** in this run environment, AssemblyAI's Agents REST API and WS gateway are network-partitioned — an agent created via a request from Vercel's serverless network was consistently invisible (`404` on GET, absent from `LIST`, `agent_not_found` on WS `session.update`) to REST/WS calls from the probe machine's network, and symmetrically the reverse, sustained over 30+ minutes with no convergence, confirmed with both `fetch` and raw `curl` against `agents.assemblyai.com` directly (plain `uvicorn` responses, no CDN in the path). `/api/call` itself is unmodified and not at fault — a fresh agent created from the *same* network path as the WS connection resolves immediately. The gate probes below therefore mint the token via `/api/call` (unaffected — tokens are not agent-scoped) but create their own throwaway agent directly, from the same vantage point as the WS connection, using the exact payload shape of `lib/agent-config.ts`'s `buildAgentPayload()`. **This is a real risk worth escalating**, not just a probe inconvenience: production's real users also connect from outside Vercel's network (browser demo, §0), so if this partition is systemic rather than a momentary account/regional fluke, real calls could hit the same `agent_not_found`. Needs monitoring/retry-with-recreate logic before demo day; out of this session's scope to fix.

| Gate | Result | Evidence |
|---|---|---|
| **G1** | **PASSED**, on the second attempt, via a different mechanism | `conversation.message` **FAILED** — sent exactly per the documented shape, both roles, plain ASCII and sentinel-wrapped, with and without an 800 ms gap before `reply.create`, across 4 independent sessions: it never appeared in the request body. **`reply.create { instructions }` PASSED** — the text arrives as the **last** `messages` entry, `role: "system"`, **byte-identical** across 5 adversarial cases (em dash, typographic quotes, `£30 & €40`, newline/tab, astral-plane emoji, 917 characters), with `U+0001` intact and nothing appended. The arrival is **one-shot**: present in its own turn's body, gone from the next. Mid-session `system_prompt` mutation also delivers but is sticky and overwrites the stored prompt — rejected. Full evidence, including the captured request headers, in [`gate-results-2026-09-22.md`](../../research/gate-results-2026-09-22.md). |
| **G2** | **PASSED** | With nothing queued (no `conversation.message` sent — true idle — and also, incidentally, in all 4 of G1's failed-injection runs, since the server never saw a pending utterance either way), `reply.create` produced `reply.audio` frames for ~2.4 s but **zero** `transcript.agent` events across 5 separate turns. No words were transcribed as spoken. Minor nuance: audio frames were still streamed for the full ~2.4 s window even though nothing was said (possibly comfort-noise/silence padding) — worth confirming this doesn't hold the channel awkwardly against real barge-in, but it did not vocalise words over the hearing party. |
| **G3** | **PASSED** | `reply.create` → first `reply.audio`, measured 2026-09-23 with **real echoed content**: **28 ms, 29 ms, 30 ms** (mean 29 ms). The extra hop is not a latency risk in verbatim mode, which is what running no model buys. |
| **G4** | **PASSED** | Measured 2026-09-23 end to end against the live deployment. `transcript.agent.text` came back **byte-identical** to the text sent, on all three utterances — including the `415 555 0134` phone-number case this gate names, an em dash and typographic apostrophes. TTS normalisation did not alter anything. The normalised comparison in §3.3 stays, as belt-and-braces rather than a load-bearing correction. |
| **G5** | **PASSED** | `DELETE https://agents.assemblyai.com/v1/sessions/{id}` → **204** in **374 ms**, called shortly after `session.ended`. No retry needed. |

**Net effect:** all five gates are closed. The server is stateless as designed (§3.1), by `reply.create { instructions }` rather than the `conversation.message` this spec originally specified. Two further facts came out of the captured request headers and are load-bearing elsewhere: our endpoint has a **10-second read timeout**, and AssemblyAI **retries** — on a relay a retry means a sentence could be spoken twice (§8).

### 3.3 The ledger

Per utterance: `{ id, typedText, spokenText | null, mode: "verbatim" | "assistant", status }`.

- `typedText` is captured client-side at send time. It is the ground truth.
- `spokenText` arrives on `transcript.agent`, which also carries `interrupted`.
- `status`: `pending` → `match` | `mismatch` | `interrupted`.
- **Comparison is normalised**, not naive: trim, collapse internal whitespace, strip trailing sentence punctuation, compare case-insensitively. Anything beyond that is a **mismatch and must be shown as one.** The ledger's value is entirely in it being willing to say no.
- The header reads `N of N relayed verbatim`. If one mismatches, it says so. Do not suppress it; a ledger that cannot fail proves nothing.

### 3.4 What the model is never asked to do

There is no prompt anywhere instructing a model to repeat the user's words. Verbatim is not requested; it is the absence of a model. This is the whole argument (PRD §7) and it is load-bearing — if an implementation ever routes verbatim text through an LLM "just for tidying," the product's claim is void.

---

## 4. The two modes

### 4.1 Verbatim (default, and the only mode that speaks in the user's name)

As §3. The agent says what the user typed, and nothing else.

### 4.2 Assistant (opt-in, navigation only)

The user taps a clearly-marked control. From then until they tap it off, the endpoint stops echoing and proxies to AssemblyAI's LLM Gateway (`https://llm-gateway.assemblyai.com/v1`, an OpenAI-compatible endpoint), passing the conversation through and streaming the reply back.

Mode travels in band, like the text: the sentinel is `\u0001ASSIST\u0001`. The server stays stateless.

Rules, enforced in code and copy, not just in the prompt:

1. **Off by default; never self-enabling.** No heuristic turns it on.
2. **It does not impersonate the user.** The system prompt (§4.4) makes the agent identify itself as an automated assistant on a relay call.
3. **It does not answer for the user.** It navigates menus, holds, and says who is calling. Anything substantive is handed back: it says the user will type their answer.
4. **The ledger records the mode per utterance,** and assistant-mode lines are visually distinct and excluded from the verbatim count.

Note: **LLM Gateway is excluded from the $50 of free AssemblyAI credits** and bills from the balance from the first request (integration §10, Billing). Assistant mode costs real money; verbatim mode does not.

### 4.3 Why assistant mode exists at all

Because phone menus are a documented barrier — *"I hate that"*, on automated systems requiring button presses during a relay call (Steinberg et al. 2006). Removing the machine part of the call is a real accessibility gain. Speaking *for* a person is not the same thing, and the line between them is exactly where a product like this goes wrong.

**This is the open question to put to someone with lived experience** (PRD §10.2). If the answer is "never, under any circumstances," delete §4.2 and the product is still whole.

### 4.4 The system prompt (assistant mode only)

Unreachable in verbatim mode, because in verbatim mode no model runs.

```
You are an automated relay assistant on a live phone call. The person you are
helping is deaf and communicates by typing.

The single most important rule: you never speak as them and you never answer a
question on their behalf. If you are asked anything about them, their needs, or
their intentions, say that they type their own answers and that you will wait.

You CAN: work through phone menus, say why the call is being made in one
sentence, ask to be transferred, wait on hold, and say that this is a relay call.
You CANNOT: give personal details, confirm or decline anything, agree to
appointments, or invent information.

If asked who you are: "I'm an automated assistant on a relay call. The caller
types and their words are read out."

Speak in short, plain sentences. Never use markdown. Read digits one at a time.
```

---

## 5. Retention: the call is deleted when it ends

### 5.1 Why

47 CFR § 64.604(a)(2)(i) prohibits a relay provider from keeping the content of a relayed conversation beyond the duration of the call (pitch-stats §1.2). AssemblyAI records **every** session automatically, with no configuration. That recording is call content, on someone else's servers.

### 5.2 How

1. The user hangs up. The browser sends `{"type":"session.end"}` and waits for `session.ended`. (Never `{"type":"Terminate"}` — that is realtime STT. Never close the socket bare: it leaves a **billable** 30-second resume window.)
2. `POST /api/end { sessionId }` → server calls `DELETE /v1/sessions/{sessionId}` → `204`.
3. The UI shows: **"Recording deleted"**, with the session id and the timestamp of the 204.
4. The ledger is client-side only and is cleared with the page. It is never posted anywhere.
5. A `pagehide` handler sends `session.end` synchronously and fires `/api/end` via `navigator.sendBeacon`, because nothing async survives a closing tab.

`DELETE /v1/sessions/{id}` is a **soft delete** returning 204: the session stops appearing in `GET /v1/sessions` and its artifacts become inaccessible (verified 2026-09-22, [session-history.md](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/session-history.md)). Say exactly that on screen. Do not write "erased from existence."

### 5.3 When deletion fails

Retry with backoff up to 10 s. If it still fails, the UI says so plainly — *"We could not confirm deletion. Session `sess_…` may still be retained by the provider."* — and offers the id. A silent failure here is worse than the feature not existing.

### 5.4 Latency, without keeping anything

The one number worth showing is `time_to_first_audio_ms` from the session's `timeline` artifact. It lives in the same recording we are about to delete. **Resolution:** read the timeline once, extract only the per-turn latency numbers, show the median, then delete — the numbers are not conversation content. If that ordering ever looks like an excuse to keep the transcript, drop the feature instead.

---

## 6. Data flow, event by event

```
client                                   server / AssemblyAI
  │ POST /api/call ─────────────────────► ensure agent, GET /v1/token
  │◄─ { token, agentId } ────────────────
  │── WS connect ?token=… ──────────────►
  │── session.update { agent_id } ──────►
  │◄─ session.ready { session_id, config }   ← log config; it is the resolved truth
  │── input.audio (base64 PCM16 24k) ───►    ← only after session.ready
  │◄─ input.speech.started ──────────────    ← flush playback for snappy barge-in
  │◄─ transcript.user.delta ─────────────    ← text is the FULL transcript so far: REPLACE
  │◄─ transcript.user ───────────────────    ← finalise the caption line
  │                                          ← agent stays silent: our endpoint returns empty (G2)
  │ user types, presses send:
  │── reply.create { instructions:"\x01SAY\x01…\x01END\x01" } ─►
  │                                       AssemblyAI ──► POST /api/llm/v1/chat/completions
  │                                          the text is the LAST message, role "system"
  │                                                  ◄── stream: the typed text, unmodified
  │◄─ reply.started ─────────────────────
  │◄─ reply.audio { data } ──────────────    ← base64 PCM16 in `data`, NOT `audio`
  │◄─ transcript.agent.delta ────────────    ← word-level with start_ms/end_ms
  │◄─ transcript.agent { text, interrupted } ← THE RECEIPT → ledger diff
  │◄─ reply.done { status } ─────────────
  │── session.end ──────────────────────►
  │◄─ session.ended ─────────────────────
  │ POST /api/end { sessionId } ────────► DELETE /v1/sessions/{id} → 204
```

---

## 7. Browser audio

Carried over from the previous spec unchanged, because it is product-neutral and correct. Full detail in integration §10 → Browser integration. The four that cost an afternoon each:

1. **Never `new AudioContext({ sampleRate: 24000 })`.** Firefox honours it and silently loses echo cancellation, so the agent interrupts itself every reply; Safari ignores it and garbles the audio. Let the context pick its rate, pass `audioCtx.sampleRate` into the worklet via `processorOptions`, resample to 24 kHz **inside the worklet**. Linear interpolation is fine for speech.
2. **`getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } })`** — exactly this. AEC on, or the mic hears the TTS through the speakers and the hearing party's captions fill with our own words. Noise suppression off; the server already denoises.
3. **`input.audio` carries audio in `audio`; `reply.audio` carries it in `data`.**
4. **On barge-in, `stop()` the already-scheduled `AudioBufferSourceNode`s.** Resetting the playback cursor alone leaves stale audio playing. Flush on `input.speech.started` and again on `reply.done{status:"interrupted"}`.

Capture must terminate at the worklet — connecting through to `ctx.destination` plays the room back into the room.

---

## 8. Error handling

| Failure | Surface | Behaviour |
|---|---|---|
| No `ASSEMBLYAI_API_KEY` | `/api/call` | 500 with a plain message. The page says the demo is not configured. |
| Token mint fails | `/api/call` | Pass the upstream status and body through; do not swallow. |
| WS closes 1006 before `session.ready` | browser | Pre-handshake failures carry no payload in browsers. Show "could not connect", offer retry, mint a **fresh** token (tokens are single-use). |
| `session.error` `immutable_field` | browser | A bug in our code. Log the `param`, keep the call alive. |
| `agent_id_not_first` | browser | We sent inline fields alongside `agent_id`. Log loudly; it is always a code bug. |
| `session_expired` (1008) | browser | No warning event precedes it. Run a client-side timer against `max_session_duration_seconds` and warn at T-60s. |
| Unintentional drop | browser | Within 30 s, reconnect with a **fresh** token and `session.resume { session_id }` first. On `session_not_found`/`forbidden`/`expired`, start a new session and say so on screen. |
| `/api/llm` called with a bad shared secret | server | 401. AssemblyAI's `api_key` is the only caller that should reach it. |
| `/api/llm` cannot find the sentinel | server | Stream back **empty** and log. Never guess at content. Silence is the safe failure for a relay. |
| `/api/llm` takes longer than 10 s | server | The caller is the OpenAI Python SDK with `x-stainless-read-timeout: 10.0` (measured 2026-09-22). Verbatim returns in milliseconds; assistant mode must stream its first byte inside the budget or fall back to the fixed sentence. |
| AssemblyAI **retries** a chat-completions request | server → the line | **Measured 2026-09-23: no action needed.** A `5xx` or a read timeout past 10 s triggers a retry, capped at 2 retries (3 attempts) before it gives up. A mid-stream failure *after* content was delivered triggers none. In all four forced failure modes the sentence was spoken **exactly once, or not at all** — never twice. It is safe structurally: retries happen before audio is committed, one `reply.create` yields one reply, and the handler is idempotent because a retried request carries the same sentinel. Total failure yields silence, which is the safe failure for a relay. |
| `agent_not_found` on connect | browser → `/api/call` | The stored agent may be invisible from the user's network (§2.3). Re-POST `POST /api/call { "recreate": true }`, which skips the reuse path and creates a fresh agent, mint a **fresh** token (single-use), and reconnect. Bound the attempts; do not loop. |
| `/api/call` called too often, or without the demo code | server | 429 with `Retry-After`, or 403. Sessions bill on socket-open duration, so token minting is the thing worth limiting. The code is unset by default so a judge's link works without one. |
| LLM Gateway error in assistant mode | server | Stream a single fixed sentence — "The assistant is unavailable; the caller will type." — and flip the UI back to verbatim. |
| `DELETE /v1/sessions` fails | browser | §5.3. |
| Mic permission denied | browser | The call can still *speak*; captions are dead. Say exactly that; do not pretend the call is fine. |

**Billing safety.** Sessions bill on WebSocket-open duration including idle time. Mint tokens with `max_session_duration_seconds` set (600 for the demo), always send `session.end`, and wire `pagehide`.

---

## 9. Testing

**Unit (Vitest), where a pure function exists:**

- PCM codec: clipping at the rails, base64 round-trip, buffers past the argument-spread limit, resample ratios for 44.1 kHz and 48 kHz.
- Playback scheduler: chunks scheduled back to back; never scheduled in the past; `flush()` **stops** scheduled sources, not just the cursor.
- The sentinel protocol: encode/decode, mode extraction, text containing the sentinel character, empty text.
- The ledger reducer: pending → match, normalisation-only difference → match, real difference → mismatch, `interrupted` → interrupted, out-of-order `transcript.agent`.
- The OpenAI SSE encoder: chunk shape, `[DONE]` terminator, empty-content case.
- `/api/llm` route handler, against a recorded request body: verbatim echo is byte-identical.

**Integration, by hand, because a socket and a microphone are not unit-testable:**

1. The five validation gates (§3.2) — before anything else is built.
2. A full call in Chrome, Firefox and Safari: connect, greeting audible, type, hear it, see the receipt match, see captions, hang up, see the deletion confirmed.
3. Barge-in: type a long sentence, talk over it, confirm the audio actually stops.
4. Mismatch path: force a mismatch (send text the TTS will normalise) and confirm the ledger says mismatch rather than hiding it.
5. Deletion failure path: point `/api/end` at a bad id and confirm the honest error.

**Explicitly not tested:** TTS quality, ASR accuracy. They are AssemblyAI's, and measuring them here would be theatre.

---

## 10. Stack and layout

Next.js 15 (App Router) · TypeScript strict · Tailwind · Vitest · deployed on Vercel.

```
app/
  page.tsx                      the one screen
  api/call/route.ts             POST — ensure agent, mint token
  api/llm/v1/chat/completions/route.ts   POST — the pass-through
  api/end/route.ts              POST — DELETE the session
lib/
  audio/pcm.ts · capture.ts · playback.ts
  agent-config.ts               the stored-agent payload
  sentinel.ts                   in-band mode + text protocol
  ledger.ts                     the reducer
  openai-sse.ts                 streaming chunk encoder
  relay-client.ts               the WebSocket state machine
public/pcm-processor.js         the AudioWorklet (must be a URL, not bundled)
```

`ASSEMBLYAI_API_KEY` and `ALOUD_LLM_SHARED_SECRET` are read **only** inside `app/api/**`. Any `NEXT_PUBLIC_` variable holding either is a build failure.

---

## 11. Open, and owned by the user

1. **The voice.** `output.voice` is immutable per session and it is the user's voice on that call. Someone should choose it deliberately — ideally the user picks, per call, before dialling. v1 ships `jane` as a default and exposes the choice.
2. **Whether assistant mode should exist** (§4.3). Ask a person with lived experience. Their answer wins.
3. **Whether the hearing party is told a machine is speaking.** `greeting` currently says so. There is a real argument both ways, and it is not ours to settle.

---

## 12. Self-review

Checked 2026-09-22 against the brainstorming skill's spec review: no placeholders or TBDs; §2.2's configuration matches §6's flow and §8's error table; scope is one implementation plan; the two readings that could have been ambiguous — what "verbatim" is enforced by (§3.4: the absence of a model, not a prompt) and whether any recording survives the call (§5: no, and §5.4 states the one exception and its limit) — are stated explicitly.
