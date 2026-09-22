# AssemblyAI Integration — Coding Agent Instructions

Split out from `CLAUDE.md` to keep that file short — see `CLAUDE.md` for a pointer back here. Always fetch `https://www.assemblyai.com/docs/llms.txt` before writing AssemblyAI code — this file is a snapshot and the API moves.

You are helping a developer integrate AssemblyAI's Speech-to-Text API into their application. Your job is to understand their context through discovery, produce a concrete implementation plan, get their approval, and then write correct, production-ready code.

This is a public API. The developer creates their own key at [assemblyai.com/dashboard/api-keys](https://www.assemblyai.com/dashboard/api-keys).

**Official documentation.** Two ways to wire your coding agent up to live docs (both recommended — they layer):

1. **Project instructions** (every prompt): add to `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, or equivalent:

   ```
   Always fetch https://www.assemblyai.com/docs/llms.txt before writing AssemblyAI code.
   The API has changed — do not rely on memorized parameter names.
   ```

   `llms.txt` is the structured index. For full content use `llms-full.txt`; narrow with `?lang=python` or `?lang=typescript`, or add `?excludeSpec=true` to skip the API spec.

2. **Docs MCP server** (on-demand lookups): `https://mcp.assemblyai.com/docs` — Streamable HTTP transport. Provides `search_docs`, `get_pages`, `list_sections`, `get_api_reference`.

   ```bash
   # Claude Code
   claude mcp add assemblyai-docs --transport http https://mcp.assemblyai.com/docs
   ```

   See the [Coding agent prompts](https://www.assemblyai.com/docs/coding-agent-prompts) page for Cursor and other clients.

---

## 0. Operating Rules

1. **Discovery first, code later.** Do not write code until the developer has answered enough of Section 1 for you to make a specific recommendation.
2. **One question per message.** Never batch discovery questions. Wait for an answer before asking the next one.
3. **Plan before you build.** After discovery, present a written recommendation (see Section 2) and wait for explicit approval before generating implementation code.
4. **Prefer the official SDKs.** Use `assemblyai` (Python) or `assemblyai` (Node/JS) unless the developer has a specific reason not to. The SDKs handle polling, uploads, WebSocket lifecycle, and session termination correctly — which is where most hand-rolled integrations fail.
5. **Never expose the API key in client-side code.** For browser or mobile realtime, always mint a temporary token server-side. For pre-recorded, proxy uploads and submissions through your server.
6. **Authorization header is the raw key — no `Bearer` prefix.** This trips up everyone. **One exception:** the Voice Agent API (Section 10) requires `Authorization: Bearer YOUR_API_KEY`. Don't generalize either rule across products.
7. **Set `speech_models` explicitly on pre-recorded requests.** It's *optional* — if omitted, the API defaults to `["universal-3-pro", "universal-2"]` — so to run the current flagship you must pass it yourself: recommended `["universal-3-5-pro", "universal-2"]` (see Section 5 for semantics). `universal-3-5-pro` is the current flagship; `universal-2` is the broadly-available fallback. (On *realtime*, the singular `speech_model` **is** required.)
8. **Always terminate realtime sessions explicitly.** An abandoned WebSocket keeps accruing charges until the 3-hour cap.
9. **Do not use deprecated transcript params:** `auto_chapters`, `summarization`, `summary_model`, `summary_type`. Use LLM Gateway instead (Section 8).
10. **If the developer's answers are inconsistent, stop and surface the conflict.** Example conflicts: "browser-only, no backend" + "realtime"; "phone call audio" + "upload a file"; "real-time" + "need speaker diarization with full names." Don't paper over these — ask.
11. **Be flexible.** If something the developer says doesn't match the shape of the API (e.g., they describe a use case that isn't supported — see Section 13), say so directly and propose the closest supported alternative.
12. **Verify parameters against live docs before recommending.** This file is a snapshot — features move between beta and GA, model-specific behaviors change, and new knobs ship regularly. Before posting the Section 2 recommendation, confirm each parameter you plan to use is supported for the chosen **mode** (pre-recorded vs realtime) *and* **model** (U3.5 Pro, U2, U3 Pro realtime, Universal-streaming). Do not assume a pre-recorded flag works on realtime, or that a parameter supported on U2 still behaves the same on U3 Pro. Pull the current reference rather than memorizing. Primary sources, in order of preference:
    - `https://www.assemblyai.com/docs/llms-full.txt` — the canonical machine-readable reference
    - Per-mode docs: `/docs/pre-recorded-audio/*` (pre-recorded) and `/docs/streaming/*` (realtime), including the model-specific overview page (e.g.,`/docs/streaming/select-the-speech-model`) which lists *exactly* which parameters are honored/ignored by that model
    - The OpenAPI-backed API reference at `/docs/api-reference/*` for request/response schemas
    - For LLM Gateway: `/docs/llm-gateway/quickstart` lists the current valid `model` strings — don't guess short names like `claude-sonnet-4`
  If a flag you remembered isn't in the current docs (or is marked beta / deprecated / ignored for the chosen model), flag it in the recommendation's "Open questions / assumptions" block and ask the developer before proceeding.

---

## 1. Discovery Questions

Ask these **one at a time**, in order. Skip any question already answered in the conversation. Adapt wording to sound natural, but cover the substance of each.

1. **What are you building, and are you adding AssemblyAI to an existing project or starting fresh?** (A short description of the product is usually enough.)
2. **What do you need: pre-recorded transcription, realtime STT, or a managed voice agent?**
   - Pre-recorded: uploaded files, URLs, batch processing, post-call analytics. → Section 6.
   - realtime STT: live transcripts only (you bring your own LLM/TTS). Live captioning, voice-agent STT, meeting notetaking. → Section 9.
   - Voice Agent API (managed): full-duplex speech-in/speech-out — STT + LLM + TTS + turn detection + tool calling, all in one WebSocket. Right answer when "I want to talk to an AI" is the whole product. → Section 10.
3. **Where is your audio coming from?** (e.g., uploaded files, public URLs, browser microphone, mobile app, Twilio/Telnyx phone numbers, SIP trunks.)
4. **What language and framework are you using?** (e.g., Python + FastAPI, Node + Next.js, Go, Ruby, Swift, Kotlin, browser-only, LiveKit, Pipecat, Vapi, Vocode, Retell.)
5. **Do you already have an AssemblyAI API key, or do you need to create one?** (If needed: [assemblyai.com/dashboard/api-keys](https://www.assemblyai.com/dashboard/api-keys).)
6. **Do you have a data residency requirement?** (US vs EU — this changes the base URL.)
7. **Anything beyond a plain transcript?** Don't read off a checklist. Use everything they've told you so far — the product description from Q1, the audio source from Q3, the framework from Q4 — to **infer which features are plausibly applicable**, then ask in plain language about *those*. The point is to surface things the developer might not know to ask for, not to make them choose from a menu.

   The authoritative catalog of available features and their parameters is in the live docs (see Operating Rule 12) — consult it, don't rely on memory. Section 3 of this file is a starting reference, not the final word.

   Calibrate to mode and use case. Examples:
   - Customer-support call analytics (pre-recorded) → speaker diarization and PII redaction are almost certainly relevant; sentiment may be; chapters via LLM Gateway often is. Ask about those, not about live-realtime features.
   - Browser live-captioning (realtime) → ask about multilingual support and domain vocabulary; don't bring up PII redaction or summaries-during-session (neither applies to realtime).
   - Voice agent (realtime) → keyterms prompting and turn-detection tuning matter; speaker diarization usually doesn't.
   - Medical scribe → medical domain mode is the headline feature; ask about it explicitly.

   Don't ask about things the user gets automatically with no toggle (word-level timestamps and confidence on `words[]`, realtime `SpeechStarted` events). Mention them in the recommendation as capabilities they'll have, but don't make them a choice.

   If you're confident from context that a feature is needed (e.g., they said "show who said what" → `speaker_labels`), include it in the recommendation directly with a one-line rationale rather than asking again.

---

## 2. Recommendation Template (after discovery)

Before writing code, post a plan with all of the following. Get explicit approval.

```
## Recommendation

**Use case:** <one-sentence summary of what they're building>
**Mode:** <pre-recorded / realtime / both>
**Region:** <US or EU base URL>

**Model:**
- <model name> — <one-line rationale>
- <fallback model, if applicable>

**Endpoints:**
- <endpoint 1>
- <endpoint 2>

**Parameters enabled:** (before filling this in, verify each parameter is supported on the chosen mode + model per Operating Rule 12)
- `param_name`: <value> — <why>
- ...

**Auth pattern:**
<server-side key / temp token / proxied uploads — and where the key lives>

**Termination & error handling:**
<how realtime sessions are closed; how errors / retries are handled>

**Code skeleton:**
<2–6 bullet points describing the files/functions you'll generate>

**Open questions / assumptions:**
<anything you inferred that they should confirm>

Ready to proceed?
```

If they say yes, write the code. If they push back on any piece, revise the plan — don't just start coding around objections.

---

## 3. Feature Selection Guide (agent reference)

Use this to build the recommendation. Do not dump it on the user.

| Developer need | Parameter / approach |
|---|---|
| Speaker diarization | `speaker_labels: true` (pre-recorded, and realtime on U3.5 Pro — realtime adds a `speaker_label` to each Turn event and a `speaker` to each final word; tune with `max_speakers`, and watch for the late `SpeakerRevision` message that refines earlier turns — see Section 9) |
| Automatic language detection | `language_detection: true` (pre-recorded; **also supported on U3.5 Pro realtime**, where it adds `language_code` + `language_confidence` to Turn events) |
| Specific language | `language_code: "es"` etc. — pre-recorded, **and U3.5 Pro realtime** (steers per-token toward one of 18 languages). On U3.5 Pro, omit it to let the model code-switch natively |
| Multilingual / code-switching | U3.5 Pro handles code-switching across its 18 languages **natively, no config needed** (`speech_models: ["universal-3-5-pro"]` pre-recorded / `speech_model=universal-3-5-pro` realtime) |
| Prompting | `prompt: "..."` — flexible natural-language guidance: describe the audio (domain, scenario, names) and/or steer behavior, e.g. `"Transcribe in Spanish."`, or for code-switching `"Transcribe this. Mixed languages in their own characters."`. `language_code` is just a structured shortcut for the language-steering case. Depth levels (domain / scenario / detailed) in Section 6.2. Pre-recorded and U3.5 Pro realtime (max ~1500 chars on realtime) |
| Domain-specific vocabulary | `keyterms_prompt: [...]` (pre-recorded U3.5 Pro: up to 1,000 phrases, ≤6 words each — caps differ on other models, verify per docs; realtime: up to 100 terms) |
| Medical domain | `domain: "medical-v1"` (pre-recorded *and* realtime; supported languages: en, es, de, fr) |
| PII redaction in text | `redact_pii: true` + `redact_pii_policies: [...]` + optional `redact_pii_sub: "hash" \| "entity_name"` (pre-recorded, **and U3.5 Pro realtime** — realtime applies it to final turns only and forces `include_partial_turns: false`). **Not available on the Voice Agent API** — see the §10 note; a marketing page claims otherwise, no technical reference supports it. 51 policy names, incl. `person_name`, `date_of_birth`, `phone_number`, `healthcare_number`, `medical_condition`, `medical_process`, `drug`, `injury`, `location_address`, `us_social_security_number` |
| PII redaction in audio | `redact_pii_audio: true` (pre-recorded only; original file ≤1 GB; redacted audio URL available for 24 h; `redact_pii_audio_quality` `mp3`/`wav`, `redact_pii_audio_options.override_audio_redaction_method: "silence"` to silence instead of beep) |
| Background-noise / voice isolation (realtime) | `voice_focus: "near-field" | "far-field"` (U3.5 Pro realtime) + optional `voice_focus_threshold` (0.0–1.0) |
| Per-turn LLM on the live stream | `llm_gateway: <JSON config>` on the realtime connection — runs an LLM Gateway request on each finalized turn (translation, classification, structured extraction) and returns `LLMGatewayResponse` events |
| Chapters or summaries (batch) | Transcribe first, then LLM Gateway (Section 8) |
| Translation / speaker ID / custom formatting (batch) | `speech_understanding: { request: { ... } }` on `/v2/transcript` — Translation (`translation.target_languages` → `translated_texts`), Speaker Identification (`speaker_type: "role" | "name"`, attribute turns to speakers you supply), Custom Formatting (date/phone/email patterns). See [Speech Understanding](https://www.assemblyai.com/docs/speech-understanding/translation). For *realtime* translation use `llm_gateway` instead (above) |
| Word timestamps / confidence | Included by default on `words[]` |
| Webhook delivery (skip polling) | `webhook_url: "..."` (Section 7) |
| Managed voice agent (speech-in / speech-out) | Voice Agent API (Section 10) — one WebSocket, no separate STT/LLM/TTS |
| Custom voice agent (your LLM + TTS) | realtime STT + framework integration (Section 11) |

---

## 4. API Overview

- **REST base URL (US):** `https://api.assemblyai.com`
- **REST base URL (EU):** `https://api.eu.assemblyai.com`
- **realtime WebSocket (Edge, default):** `wss://streaming.assemblyai.com/v3/ws` — auto-routes to the nearest region (Oregon / Virginia / Ireland) for lowest latency
- **realtime WebSocket (US data residency):** `wss://streaming.us.assemblyai.com/v3/ws` — data pinned to US
- **realtime WebSocket (EU data residency):** `wss://streaming.eu.assemblyai.com/v3/ws` — data pinned to EU
- **LLM Gateway (US):** `https://llm-gateway.assemblyai.com/v1/chat/completions`
- **LLM Gateway (EU):** `https://llm-gateway.eu.assemblyai.com/v1/chat/completions` — Claude and Gemini only; OpenAI/Qwen/Kimi are US-only
- **Auth header:** `Authorization: YOUR_API_KEY` (no `Bearer`). Same header is used for REST, realtime WS upgrade, temp-token minting, and LLM Gateway
- **Content type:** `application/json` for submit/poll and LLM Gateway; `application/octet-stream` (raw binary) for `/v2/upload`

Core REST endpoints:
- `POST /v2/upload` — upload a local file (raw binary body, **not multipart**). Returns `{ "upload_url": "..." }`. Max 2.2 GB.
- `POST /v2/transcript` — submit a job. Returns transcript object with `id` and `status: "queued"`. Max 5 GB / 10 hours.
- `GET /v2/transcript/{id}` — poll. Statuses: `queued`, `processing`, `completed`, `error`.

realtime:
- `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=universal-3-5-pro&mode=balanced`
- `GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=60` — mint a single-use temp token for browser/mobile clients. Optional `max_session_duration_seconds` (60–10800, defaults to 3 h) caps the downstream session length.

---

## 5. `speech_models` Semantics

`speech_models` on pre-recorded requests is an **ordered fallback list**, not parallel execution. The first model in the array is tried; if it's unavailable (e.g., not yet rolled out to the account, or temporarily unhealthy), the next is used. A single transcript is produced by exactly one model. This is **model-availability** fallback — distinct from U3.5 Pro's internal **language** fallback (below).

Recommended value: `["universal-3-5-pro", "universal-2"]` — tries the current flagship first, falls back to the broadly-available stable model. The parameter is **optional**; if you omit it the API applies its own default of `["universal-3-pro", "universal-2"]`, so set it explicitly to get U3.5 Pro. (The singular `speech_model` request param is deprecated — use the plural `speech_models` array.)

`universal-3-5-pro` natively transcribes **18 languages** with code-switching; for audio in any other language it **automatically falls back to Universal-2** (99 languages total) with no extra configuration. So `["universal-3-5-pro", "universal-2"]` gives you the best model where it's supported and full language coverage everywhere else.

On realtime the parameter is **singular and a different string convention**: `speech_model=universal-3-5-pro` (no array, no fallback list). Pre-recorded takes a plural **array**; realtime takes a singular **string**. This mismatch is the single most common mistake — see the gotchas in Section 15.

---

## 6. Pre-Recorded Quick Start

### SDK (recommended)

**Python:**
```python
# pip install assemblyai==1.5.4
import assemblyai as aai
import os

aai.settings.api_key = os.environ["ASSEMBLYAI_API_KEY"]

config = aai.TranscriptionConfig(
    speech_models=["universal-3-5-pro", "universal-2"],  # fallback handled by SDK
    speaker_labels=True,
)

transcript = aai.Transcriber(config=config).transcribe("https://assembly.ai/wildfires.mp3")
# Or a local path: .transcribe("./recording.wav")

if transcript.status == aai.TranscriptStatus.error:
    raise RuntimeError(transcript.error)
print(transcript.text)
```

**Node/JS:**
```javascript
// npm install assemblyai@4.41.1
import { AssemblyAI } from 'assemblyai';

const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

const transcript = await client.transcripts.transcribe({
  audio: 'https://assembly.ai/wildfires.mp3', // or a local file path / Buffer / stream
  speech_models: ["universal-3-5-pro", "universal-2"],
  speaker_labels: true,
});

if (transcript.status === 'error') throw new Error(transcript.error);
console.log(transcript.text);
```

The SDK handles upload, submit, and polling. You don't need to write the polling loop yourself.

### Raw HTTP (fallback — use only if SDK isn't an option)

**Upload a local file** (raw bytes, not multipart):
```bash
curl -X POST https://api.assemblyai.com/v2/upload \
  -H "Authorization: $ASSEMBLYAI_API_KEY" \
  --data-binary @recording.wav
# -> { "upload_url": "https://cdn.assemblyai.com/upload/..." }
```

**Submit and poll (Python):**
```python
import os, time, requests

headers = {"authorization": os.environ["ASSEMBLYAI_API_KEY"]}

submit = requests.post(
    "https://api.assemblyai.com/v2/transcript",
    headers=headers,
    json={
        "audio_url": "https://assembly.ai/wildfires.mp3",
        "speech_models": ["universal-3-5-pro", "universal-2"],
        "speaker_labels": True,
    },
)
transcript_id = submit.json()["id"]

while True:
    res = requests.get(
        f"https://api.assemblyai.com/v2/transcript/{transcript_id}",
        headers=headers,
    ).json()
    if res["status"] == "completed":
        print(res["text"]); break
    if res["status"] == "error":
        raise RuntimeError(res["error"])
    time.sleep(3)
```

Common optional params: `speaker_labels`, `language_detection`, `language_code`, `punctuate`, `format_text`, `redact_pii`, `redact_pii_audio`, `keyterms_prompt`, `webhook_url`, `prompt`.

### 6.1 Writing a good `prompt` (U3.5 Pro)

`prompt` takes plain, natural-language sentences that describe the audio, and it scales with how much you know. Match the depth to the context you actually have:

| Level | Length | What it contains | Example |
|---|---|---|---|
| **Domain** | 2–5 words | The domain only | `Medical consultation call.` |
| **Scenario** | 5–15 words | What the conversation is about | `Cardiology consultation about chest pain symptoms.` |
| **Detailed** | 20–50 words | Full description — names, products, identifiers | `Cardiology consultation between Dr. Smith and an elderly patient regarding recurring chest pain, ECG results, and a medication adjustment for hypertension.` |

Guidelines:
- Write **plain, complete sentences** that describe the audio.
- Keep it to **one short block of text** — don't pack a list of keywords into the prompt. For lists of exact terms (names, SKUs, jargon) use `keyterms_prompt` instead; the two are complementary.
- The same `prompt` field works on realtime U3.5 Pro (max ~1500 chars) and can additionally steer language/behavior — e.g. `"Transcribe in Spanish."` (Section 9).

This applies to both pre-recorded and realtime U3.5 Pro.

---

## 7. Webhooks (skip polling)

Provide `webhook_url` on submit; AssemblyAI POSTs when the job finishes:

```json
{ "transcript_id": "5552493-16d8-42d8-8feb-c2a16b56f6e8", "status": "completed" }
```

Handler requirements:
- Return 2xx within **10 seconds**. Otherwise retried up to 10 times, 10s apart. 4xx is not retried.
- On receipt, call `GET /v2/transcript/{id}` to fetch the full result — the webhook payload doesn't include it.

Optional custom auth on your webhook: set `webhook_auth_header_name` and `webhook_auth_header_value` when submitting.

**Source IPs** (for allowlists): US `44.238.19.20`, EU `54.220.25.36`.

**Local dev note:** Webhook URLs must be publicly reachable. Use ngrok, Cloudflare Tunnel, or similar during development.

---

## 8. LLM Gateway (chapters, summaries, custom analysis)

LLM Gateway replaces both the deprecated transcript params (`auto_chapters`, `summarization`, `summary_model`, `summary_type`) and the legacy **LeMUR** API, which sunset on 2026-03-31. If a developer mentions LeMUR or `transcript_ids`, point them at LLM Gateway and the [migration guide](https://www.assemblyai.com/docs/llm-gateway/migration-from-lemur). Workflow:

1. Transcribe normally with `POST /v2/transcript`.
2. Once `status == "completed"`, POST to LLM Gateway with the transcript text (or paragraphs from `GET /v2/transcript/{id}/paragraphs` for chapter-style output):

```bash
POST https://llm-gateway.assemblyai.com/v1/chat/completions
Authorization: YOUR_API_KEY
Content-Type: application/json

{
  "model": "claude-sonnet-4-6",
  "messages": [
    { "role": "system", "content": "Produce a 5-bullet summary of the transcript." },
    { "role": "user", "content": "<transcript.text here>" }
  ],
  "max_tokens": 1000
}
```

Model IDs are exact, versioned strings that change often — **fetch the current list from the [LLM Gateway Overview](https://www.assemblyai.com/docs/llm-gateway/overview); don't rely on memorized names** (per Operating Rule 12). They look like `claude-sonnet-4-6`, `gpt-5.2`, `gemini-2.5-pro`. A bare family name with no version suffix (e.g. `claude-sonnet-4`) is **not** valid. EU region (`llm-gateway.eu.assemblyai.com`) supports Anthropic and Google only.

Do not submit with `auto_chapters` and `summarization` both enabled — the API rejects it (`Only one of the following models can be enabled at a time: auto_chapters, summarization.`). But the broader rule is simpler: **don't use either.**

---

## 9. realtime — Universal-3-5 Pro

**WebSocket (default, Edge Routing):** `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=universal-3-5-pro&mode=balanced`

For data residency, swap the host: `streaming.us.assemblyai.com` (US-pinned) or `streaming.eu.assemblyai.com` (EU-pinned). The default host auto-routes to the nearest region.

`mode` (`min_latency` / `balanced` / `max_accuracy`) is the primary knob — see [Connection parameters](#connection-parameters) below.

**Audio format:** PCM16 signed little-endian, mono, 16 kHz. Binary WebSocket frames, **50–1000 ms per chunk**, no faster than real-time. Phone audio (`encoding=pcm_mulaw`, `sample_rate=8000`) is sent as-is — don't upsample.

**Auth:**
- Server-side: `Authorization` header on the WS upgrade.
- Browser/mobile: mint a short-lived token server-side and pass it as `?token=<token>` (no Authorization header).

Mint a token:
```bash
curl -s "https://streaming.assemblyai.com/v3/token?expires_in_seconds=60" \
  -H "Authorization: $ASSEMBLYAI_API_KEY"
# { "token": "..." }
```
`expires_in_seconds` must be 1–600. Tokens are single-use per session.

### Connection parameters

All connection parameters are passed as **query-string params on the WebSocket URL** (or via the SDK's connect/streaming params). Most are **Universal-3-5 Pro only** — don't assume they exist on the older `universal-streaming-*` models. Verify against the [Universal-3.5 Pro Streaming reference](https://www.assemblyai.com/docs/api-reference/streaming-api/universal-3-pro-streaming) (Operating Rule 12) before relying on any of them.

**`mode` is the primary control — set this first.** It's a latency/accuracy preset (`min_latency`, `balanced`, `max_accuracy`) that tunes the model's turn-detection and partial-emission defaults server-side. Picking a mode is usually enough on its own; only touch the advanced turn-detection knobs if you have a specific reason. When omitted, the server applies its own preset.

| Group | Params |
|---|---|
| **Language** | `language_code` — pin one of 18 langs (`en, es, fr, de, it, pt, tr, nl, sv, no, da, fi, hi, vi, ar, he, ja, zh`); omit to code-switch natively. `language_detection=true` — return `language_code` + `language_confidence` on Turn events. |
| **Context / accuracy** | `prompt` — flexible natural-language guidance: describe the audio and/or steer behavior, e.g. `"Transcribe in Spanish."` (max ~1500 chars; depth levels in Section 6.2). `keyterms_prompt` — up to 100 bias terms. `agent_context` — your voice agent's last spoken (TTS) reply, to bias the next turn; updatable mid-stream (max ~1500 chars). `previous_context_n_turns` — advanced conversation carryover (0–100; 0 disables); leave unset normally. |
| **Audio / noise** | `encoding` — `pcm_s16le` (default) or `pcm_mulaw`. `sample_rate` — any int 8000–96000 (default 16000). `voice_focus` — `near-field` / `far-field` background-noise suppression (off by default); `voice_focus_threshold` 0.0–1.0 (requires `voice_focus`). |
| **Turn detection** (advanced; `mode` sets these) | `min_turn_silence` (ms, clamped 50–10000), `max_turn_silence` (ms, default 1000), `vad_threshold` (0.0–1.0), `interruption_delay` (ms, 0–1000; server adds a fixed 256 ms), `continuous_partials` (default `true` — extra partials ~every 3 s during long turns), `include_partial_turns` (default `true`, but `false` when `redact_pii` is on). |
| **Diarization** | `speaker_labels=true` + optional `max_speakers` (1–10). Adds a `speaker_label` to Turn events and a `speaker` to final words; emits a late `SpeakerRevision` message (see below). |
| **Redaction / profanity** | `redact_pii=true` + `redact_pii_policies` + `redact_pii_sub` (`entity_name` / `hash`) — applies to **final turns only**. `filter_profanity`. |
| **Per-turn LLM** | `llm_gateway` — JSON-stringified Chat Completions config run on each finalized turn (translation, classification, extraction); results arrive as `LLMGatewayResponse` events. |
| **Session** | `inactivity_timeout` (5–3600 s; send `KeepAlive` to reset). |

**Not U3.5 Pro knobs:** `format_turns` and `end_of_turn_confidence_threshold` do **not** apply — formatting always tracks `end_of_turn`, and `end_of_turn_confidence` is binary (`1.0` on end-of-turn, `0.0` otherwise). They belong to the older `universal-streaming-*` models.

### Server messages (JSON)

- `Begin` — `{ type, id, expires_at }`
- `SpeechStarted` — `{ type, timestamp, confidence }`. Every `SpeechStarted` is followed by one or more `Turn` messages.
- `Turn` — `{ type, turn_order, end_of_turn, turn_is_formatted, transcript, end_of_turn_confidence, words:[...], utterance }`, plus `speaker_label` (when `speaker_labels` is on) and `language_code` / `language_confidence` (when `language_detection` is on).
  - `end_of_turn: false` → partial; `end_of_turn: true` → finalized and formatted. Always read `transcript` for current text. `utterance` is populated only on end-of-turn messages.
  - Each word is `{ text, start, end, confidence, word_is_final }`, plus `speaker` on final words when diarization is on (may be absent on a word — fall back to the turn-level `speaker_label`).
- `SpeakerRevision` — `{ type, revisions:[{ turn_order, speaker_label, words:[...] }] }`. Diarization only. Emitted at most once, right before `Termination` (after you send `Terminate`), to refine speaker labels on earlier turns. Match each revision by `turn_order` and replace that turn's `speaker_label` / per-word `speaker` — text and timestamps are unchanged. Adds ~400 ms at session close.
- `LLMGatewayResponse` — `{ type, turn_order, transcript, data }` (only when `llm_gateway` is configured; one per finalized turn).
- `Termination` — `{ type, audio_duration_seconds, session_duration_seconds }`

### Client messages

- Binary PCM16 frames — audio.
- `{ "type": "Terminate" }` — graceful end. **Always send this when done.**
- `{ "type": "ForceEndpoint" }` — force current turn to end.
- `{ "type": "KeepAlive" }` — only needed if `inactivity_timeout` is set.
- `{ "type": "UpdateConfiguration", ... }` — adjust mid-session. Updatable fields: `prompt`, `keyterms_prompt`, `agent_context`, `min_turn_silence`, `max_turn_silence`, `continuous_partials`, `vad_threshold`, `interruption_delay`. (For voice agents, push the agent's latest reply into `agent_context` after each agent turn.)

### SDK (recommended)

**Python:**
```python
# pip install assemblyai==1.5.4
import os
from assemblyai.streaming.v3 import (
    RealTimeEvents,
    RealTimeParameters,
    RealTimeTranscriber,
    RealTimeTranscriberOptions,
    TurnEvent,
)

def on_turn(_, event: TurnEvent):
    tag = "FINAL" if event.end_of_turn else "partial"
    print(f"{tag}: {event.transcript}")

client = RealTimeTranscriber(
    RealTimeTranscriberOptions(api_key=os.environ["ASSEMBLYAI_API_KEY"])
)
client.on(RealTimeEvents.Turn, on_turn)
client.connect(RealTimeParameters(sample_rate=16000, speech_model="universal-3-5-pro", mode="balanced"))

# Feed 16 kHz mono PCM16 chunks (50–1000ms each) via client.stream(chunk)
# When finished:
client.disconnect(terminate=True)  # sends Terminate and closes cleanly
```

**Node/JS:**
```javascript
// npm install assemblyai@4.41.1
import { AssemblyAI } from 'assemblyai';

const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
const rt = client.streaming.transcriber({
  sampleRate: 16000,
  speechModel: 'universal-3-5-pro',
  mode: 'balanced',
});

rt.on('turn', (turn) => {
  const tag = turn.end_of_turn ? 'FINAL' : 'partial';
  console.log(`${tag}: ${turn.transcript}`);
});
rt.on('error', (err) => console.error(err));

await rt.connect();
// rt.sendAudio(pcm16Buffer) for each 50–1000ms chunk
// When done:
await rt.close(); // sends Terminate and closes
```

### Raw WebSocket (fallback)

**Node.js (`ws`):**
```javascript
import WebSocket from 'ws';

const ws = new WebSocket(
  'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=universal-3-5-pro&mode=balanced',
  { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } },
);

ws.on('open', () => {
  // Feed PCM16 16kHz mono chunks here, 50–1000ms each.
  // Example: audioStream.on('data', (chunk) => ws.send(chunk));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'Turn') {
    console.log(msg.end_of_turn ? `FINAL: ${msg.transcript}` : `partial: ${msg.transcript}`);
  }
});

function stop() {
  ws.send(JSON.stringify({ type: 'Terminate' })); // required!
}
```

**Python (`websockets`):**
```python
import asyncio, json, os, websockets

URL = "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=universal-3-5-pro&mode=balanced"

async def run(audio_source):
    """audio_source: async iterator yielding 50–1000ms PCM16 chunks at 16kHz mono."""
    async with websockets.connect(
        URL,
        additional_headers={"Authorization": os.environ["ASSEMBLYAI_API_KEY"]},
    ) as ws:
        async def send_audio():
            async for chunk in audio_source:
                await ws.send(chunk)
            await ws.send(json.dumps({"type": "Terminate"}))

        async def recv_loop():
            async for raw in ws:
                msg = json.loads(raw)
                if msg["type"] == "Turn":
                    tag = "FINAL" if msg["end_of_turn"] else "partial"
                    print(f"{tag}: {msg['transcript']}")
                elif msg["type"] == "Termination":
                    return

        await asyncio.gather(send_audio(), recv_loop())

# asyncio.run(run(my_audio_iterator()))
```

---

## 10. Voice Agent API (managed speech-in / speech-out)

Use this when the developer wants a complete spoken AI agent — not just transcription. Single WebSocket, audio in and audio out, with STT + LLM + TTS + turn detection + tool calling all managed by AssemblyAI.

> **Verification status:** every statement in this section was checked against the live docs on **2026-09-22** by fetching the `.md` source of each page under `https://www.assemblyai.com/docs/voice-agents/voice-agent-api/` (append `.md` to any docs URL to get the raw Markdown — much better than scraping the rendered page). Pages used are cited inline. Re-verify before relying on anything here; this product is moving fast.

**Endpoint:** `wss://agents.assemblyai.com/v1/ws`
**REST base:** `https://agents.assemblyai.com`

**Auth:** `Authorization: Bearer YOUR_API_KEY` on the WebSocket and the token endpoint. The REST management endpoints (`/v1/agents`, `/v1/sessions`) accept the raw key *or* a `Bearer ` prefix (the prefix is stripped). For browsers/mobile, mint a temp token and pass it as `?token=<token>` — no `Authorization` header on the WS.

**Token endpoint:**
```bash
curl -s "https://agents.assemblyai.com/v1/token?expires_in_seconds=300&max_session_duration_seconds=8640" \
  -H "Authorization: Bearer $ASSEMBLYAI_API_KEY"
# { "token": "...", "expires_in_seconds": 300 }
```
- `expires_in_seconds` — **required**, 1–600. This is the *redemption window*: how long the client has to open a WebSocket with it. Once `session.ready` arrives it no longer applies.
- `max_session_duration_seconds` — optional, 60–10800 (default 10800). Caps how long the resulting session may run.
- Tokens are **single-use**. Fetch a fresh one immediately before every connect, including every `session.resume` reconnect. Don't pre-fetch and cache.

**Audio format** ([audio-format](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/audio-format)): base64-encoded inside JSON events (not raw binary frames — different from realtime STT). Defaults both directions: `audio/pcm` = PCM16 signed little-endian, **mono, 24 kHz**. Also `audio/pcmu` (G.711 μ-law, 8 kHz) and `audio/pcma` (A-law, 8 kHz) for telephony. ~50 ms chunks work well; exact size doesn't matter. **Send at real time, not faster** — audio beyond ~1 s per wall-clock second is *dropped*, not buffered (`audio_rate_violation`). Send raw mic audio; don't stack RNNoise/Krisp on top, use `input.voice_focus` instead.

### Two ways to configure an agent

| | Stored agent | Inline |
|---|---|---|
| How | `POST /v1/agents` once, then first `session.update` is `{"agent_id": "<id>"}` and nothing else | Full config in the first `session.update`, no `agent_id` |
| Pros | Config + secrets stay server-side; HTTP tools run server-side; same `agent_id` deploys to browser **and** a Twilio SIP number | Fully dynamic per session; mid-session `session.update` of mutable fields is unambiguous |
| Tools | Supports both HTTP tools (`http` set) and client-side function tools (`http` omitted) | Client-side function tools |
| Docs | [create-agent](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/create-agent), [manage-agents](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/manage-agents), [deploy](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/deploy) | [session-configuration](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/session-configuration) |

`agent_id` is **mutually exclusive** with the inline fields (`system_prompt`, `greeting`, `tools`, `input`, `output`). Sending both in one message, or sending `agent_id` after the first `session.update`, raises `agent_id_not_first`.

### `session.update` — every field that exists

From [Inline session configuration](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/session-configuration), whose example is explicitly labelled "every available field":

```json
{
  "type": "session.update",
  "session": {
    "system_prompt": "You are a friendly support agent. Keep responses under 2 sentences.",
    "greeting": "Hi! How can I help you today?",
    "tools": [],
    "input": {
      "format": { "encoding": "audio/pcm" },
      "keyterms": ["AssemblyAI", "Universal"],
      "transcription_mode": "balanced",
      "transcription_prompt": "Expect product names and order IDs.",
      "language_codes": ["en"],
      "voice_focus": "near-field",
      "voice_focus_threshold": 0.5,
      "turn_detection": {
        "vad_threshold": 0.5,
        "min_silence": 1000,
        "max_silence": 3000,
        "interrupt_response": true,
        "interruption_delay": 100
      }
    },
    "output": {
      "voice": "alba",
      "format": { "encoding": "audio/pcm" },
      "volume": 100
    }
  }
}
```

Every field is optional. Stored agents carry the same `input`/`output` objects, plus top-level `name`, `voice: { "voice_id": "..." }`, and `llm`.

> **There is no PII/PHI redaction on the Voice Agent API.** `redact_pii`, `redact_pii_policies`, and `redact_pii_audio` appear **nowhere** in the Voice Agent API documentation set — not in the session-configuration reference, the events reference, the create-agent "every field" example, the manage-agents schema, or the AsyncAPI spec (`/docs/api-reference/specs/voice-agent-api.yaml`). A grep of all of those for `redact|pii|hipaa|phi` returns zero hits (checked 2026-09-22). AssemblyAI's **marketing** page [voice-agents-healthcare](https://www.assemblyai.com/solutions/voice-agents-healthcare) does claim *"PHI redaction runs in-stream and is configurable per session… enable `redact_pii: true`"* — that claim is **not supported by any technical reference**. Treat in-session redaction as unavailable unless a live test proves otherwise. Redaction *is* real and documented on **pre-recorded** ([guardrails](https://www.assemblyai.com/docs/guardrails/redact-pii-from-transcripts)) and on **raw streaming STT** ([streaming/pii-redaction](https://www.assemblyai.com/docs/streaming/pii-redaction)), neither of which is this WebSocket.

**Mutability after `session.ready`.** The first `session.update` initializes the session; after that only a subset can change. Changing an immutable field raises `session.error` with code `immutable_field` and the change is dropped.

| Field | Mutable after `session.ready`? |
|---|---|
| `system_prompt` | Yes — applies from the next turn |
| `tools` | Yes — the array **replaces**, it does not merge |
| `input.turn_detection` | Yes |
| `input.keyterms` | Yes — takes effect on the next user utterance |
| `input.transcription_mode` | Yes |
| `input.transcription_prompt` | Yes |
| `input.language_codes` | Accepted, but applied on the next STT reconnect, not the current turn |
| `input.voice_focus` / `voice_focus_threshold` | Accepted, applied on the next STT reconnect |
| `input.format` | Accepted |
| `output.volume` | Yes |
| `greeting` | **No** — `immutable_field` |
| `output.voice` | **No** — `immutable_field` |
| `output.format` | **No** — `immutable_field` |

**`greeting` goes straight to TTS, never through the LLM.** Whatever string you set is spoken verbatim. Don't write a meta-instruction ("Greet the user warmly") — the TTS will read that sentence aloud. Omit `greeting` entirely to have the agent listen first.

**`transcription_prompt` ≠ `system_prompt`.** `system_prompt` shapes what the agent *says*; `transcription_prompt` (≤1750 chars) biases how the caller's speech is *transcribed*. Give it scene context ("this is a pharmacy support call"), not instructions — behavioral commands are ignored. `input.keyterms` (≤100 strings) is the companion word-boost list for exact names and codes.

### Languages — input and output cover different sets

[supported-languages](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/supported-languages), [language-selection](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/language-selection), [voices](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/voices):

- **Input (recognized, native code-switching): 18 languages** — `en es de fr pt it tr nl sv no da fi hi vi ar he ja zh`. Powered by Universal-3.5 Pro Streaming.
- **Output (spoken): 6 languages only** — English, Spanish, Italian, German, Portuguese, French. Hindi, Turkish, Dutch, Swedish, Norwegian, Danish, Finnish, Vietnamese, Arabic, Hebrew, Japanese and Mandarin are roadmap-only.
- The asymmetry is deliberate and documented: *"Because the agent recognizes more languages than it speaks, this enables translation use cases where a caller speaks one language and the agent responds in another."*
- `input.language_codes` — omit for automatic detection/code-switching; set it to steer toward a known set. Applied when the STT connection opens.

**Voices** (exact strings; `output.voice` is immutable for the session):

| Scope | Voice IDs |
|---|---|
| English 🇺🇸 | `alba`, `eve`, `george`, `jane`, `jean`, `mary`, `michael` |
| English 🇬🇧 | `anna`, `charles`, `paul`, `vera` |
| Native-accent, code-switches with English | `lola` (Spanish), `giovanni` (Italian), `juergen` (German), `rafael` (Portuguese), `estelle` (French) |

Default is `alba`. `lola` is **confirmed valid** and is the *only* Spanish voice. Pre-Voice-Agent-API names (`claire`, `dawn`, `josh`, `grace`, `pete`) are gone and are rejected at `session.update` with `invalid_value`. `GET /v1/voices` is no longer the documented source — the voices page is; prefer it, and never substitute a similar-sounding name.

### Turn detection — leave it alone

[turn-detection-and-interruptions](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/turn-detection-and-interruptions). On by default, semantic (based on meaning, not silence/volume), adaptive to the speaker's pace, and **entity-aware**: when a tool parameter expects a phone number, date or email, the agent waits for the whole value instead of cutting in after "my number is four one five…". Barge-in is semantic too — "uh-huh" doesn't interrupt, "wait, stop" does.

**The way to improve turn-taking is better tool parameter descriptions, not VAD knobs.** Setting `min_silence` or `max_silence` **disables adaptive pacing and entity-aware waiting for the rest of the session** — don't.

`input.transcription_mode` is the one knob worth touching: `min_latency` / `balanced` (default) / `max_accuracy`. It presets STT accuracy *and* end-of-turn patience. It is mutable mid-session, so the documented pattern is to switch to `max_accuracy` while capturing a value you can't get wrong (ID number, spelled name, date of birth) and back to `balanced`/`min_latency` afterwards.

`input.voice_focus`: `near-field` (default, headsets/handsets/browser) or `far-field` (speakerphone, rooms, car). `voice_focus_threshold` 0.0–1.0, default 0.85.

### Lifecycle and events

Full list: [events-reference](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/events-reference), [message-sequence](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/message-sequence).

**Client → server:** `session.update`, `session.resume`, `input.audio`, `tool.result`, `reply.create`, `conversation.message`, `session.end`.
**Server → client:** `session.ready`, `session.updated`, `input.speech.started`, `transcript.user.delta`, `input.speech.stopped`, `transcript.user`, `reply.started`, `reply.audio`, `transcript.agent.delta`, `transcript.agent`, `reply.done`, `tool.call`, `session.error`, `session.ended`.

```
client                              server
  │── WS connect ────────────────────►│
  │── session.update ────────────────►│
  │◄─ session.ready ──────────────────│  save session_id
  │── input.audio (stream) ──────────►│  only after session.ready
  │◄─ input.speech.started ───────────│
  │◄─ transcript.user.delta ──────────│  text = FULL transcript so far, do not concatenate
  │◄─ input.speech.stopped ───────────│
  │◄─ transcript.user ────────────────│
  │◄─ reply.started ──────────────────│
  │◄─ reply.audio ────────────────────│  base64 PCM16 in the `data` field
  │◄─ transcript.agent.delta ─────────│  word-level, with start_ms/end_ms
  │◄─ transcript.agent ───────────────│  after all audio; carries `interrupted`
  │◄─ reply.done ─────────────────────│  status: completed | interrupted
  │── session.end ───────────────────►│
  │◄─ session.ended ──────────────────│  then WS close 1000
```

Event details worth knowing:

- `session.ready` → `{ session_id, expires_at, resume_token, config }`. `config` echoes the **full resolved** configuration with defaults filled in — log it; it is the cheapest way to confirm what the server actually accepted.
- `transcript.user.delta.text` is the **full transcript so far** for that `item_id`, not an incremental chunk. Render the latest; never concatenate.
- **Field-name asymmetry:** `input.audio` carries audio in `audio`; `reply.audio` carries it in `data`.
- `transcript.agent.delta` gives word-level text with `start_ms`/`end_ms` aligned to the reply audio — use it for captions that track playback.
- `reply.done.status` is always present: `"completed"` or `"interrupted"`.
- `reply.create { instructions? }` makes the agent speak without a user utterance. `conversation.message { role, content }` injects context without speaking.

**Ending a session.** Send `session.end`, wait for `session.ended`, then close. **Do not just close the socket**: the server then holds the session for a 30-second `session.resume` grace window **and that window is billable**. `session.ended` carries `session_duration_seconds` and `audio_duration_seconds`. In a browser, also send `session.end` synchronously inside a `pagehide` handler (nothing async will finish).

**Resume.** Within 30 s of an *unintentional* drop, reconnect with a **fresh token** and send `session.resume { session_id }` as the first message. Failure codes: `session_not_found`, `session_forbidden`, `session_expired` → start a fresh session.

### Tools

[tools/overview](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/tools/overview), [tools/client-side-tools](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/tools/client-side-tools), [tools/http-tools](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/tools/http-tools).

Flat schema — *not* OpenAI's nested `{type:"function", function:{...}}` form:

```json
{
  "type": "function",
  "name": "get_weather",
  "description": "Get current weather for a city. Use this whenever the user asks about weather. Do not call it for anything else.",
  "parameters": {
    "type": "object",
    "properties": { "city": { "type": "string", "description": "City name, e.g. London" } },
    "required": ["city"]
  },
  "execution_mode": "interactive",
  "timeout_seconds": 120
}
```

- `execution_mode`: `"interactive"` (default — agent keeps talking, "let me check that") or `"hold"` (agent goes silent; use for >10 s operations, transfers, sensitive flows). `timeout_seconds` 1–300, default 120.
- On a stored agent, the same object plus `http: { url, http_method, headers }` makes it server-side. **Omit `http` for a client-handled tool** — stored agents support client-side function tools too.
- `session.tools` updates **replace** the array; they do not merge. This is what makes *progressive tool reveal* work: expose only the current phase's tools, and update `system_prompt` in the same message so the prompt never names a hidden tool.
- **`parameters` is not validated at `session.update` time.** A malformed schema is accepted silently and breaks tool calling at runtime. Validate locally.

**Parameter hints do two jobs** — tool-call accuracy *and* turn-detection accuracy. Beyond `type`/`description`, each property accepts `enum`, `examples` (2–4, in the exact form the tool receives), `pattern` (Python `re`, matched against the whole value, backslashes escaped in JSON), and `format` (`email`, `date`, `date-time`, `uri`). A value that fails the shape is rejected before the tool runs and the agent re-asks for just that field.

> **Re-ask loops** are almost always an over-tight `pattern` on a spoken digit sequence. Callers read digits one at a time, so the value arrives as `"4 1 5 5 5 5 2 6 7 1"`. Allow interior spaces and bound the *digit* count: `" *([0-9] *){10}"`, include a spaced `example`, and strip non-digits in your handler.

**Returning results — the timing rule that breaks everything if you get it wrong.** Send `tool.result` when `reply.done` is the **latest event you have received**. Accumulate on `tool.call`, drain in the `reply.done` handler, and also try to drain from the `tool.call` handler (your tool may resolve *after* `reply.done` already fired). Track `last_event` on `reply.started` and `input.speech.started` so results that arrive mid-turn are held. On `reply.done.status === "interrupted"`, **discard** pending results.

```js
let lastEvent = null;
const pending = [];

function flushIfIdle() {
  if (lastEvent !== "reply.done" || pending.length === 0) return;
  for (const t of pending) {
    ws.send(JSON.stringify({ type: "tool.result", call_id: t.call_id, result: JSON.stringify(t.result) }));
  }
  pending.length = 0;
}

// tool.call    → pending.push({ call_id, result: run(name, args) }); flushIfIdle();
// reply.started / input.speech.started → lastEvent = type;
// reply.done   → lastEvent = type; status === "interrupted" ? (pending.length = 0) : flushIfIdle();
```

`tool.result` fields: `call_id`, `result` (a **JSON string**, not an object), optional `is_error`. A result's `error` text is read verbatim by the model — name the failing field, say what *did* succeed so it doesn't re-ask for that too, and say what to ask for next.

**Anti-fabrication.** Gating stops a fake *action*; it doesn't stop a fake *sentence*. Pair progressive reveal with an explicit prompt clause: never state a number, name, ID or ETA unless it came from a tool result in this conversation.

### Prompting

[prompting-guide](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/prompting-guide). Order that works: (1) identity + single most important rule, front-loaded; (2) tone — permissions, length-mirroring, banned bot-tells listed as exact strings; (3) capabilities and pinned facts, explicit CAN/CANNOT lists; (4) tool-usage rules; (5) voice formatting (no markdown — `**alba**` is read aloud as "asterisk asterisk alba…"; how to read URLs and identifiers; round numbers and times); (6) engagement modes. Write policies, not decision trees. Trim something every time you add something.

### Browser integration

[browser-integration](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration). Official starters: [voice-agent-starter-js](https://github.com/AssemblyAI/voice-agent-starter-js) and [voice-agent-starter-python](https://github.com/AssemblyAI/voice-agent-starter-python) — note the JS starter currently ships **no licence file**, so read it for reference rather than copying code wholesale.

- Server mints the token; browser opens `wss://agents.assemblyai.com/v1/ws?token=…` with no `Authorization` header.
- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } })`. Echo cancellation **on** or the agent hears itself through the speakers and interrupts every reply. Noise suppression **off** — the server already denoises and a second layer costs more accuracy than the noise did.
- Capture PCM16 in an `AudioWorklet` (needs its own file URL; `MediaRecorder` cannot emit PCM16). Base64 it: `btoa(String.fromCharCode(...new Uint8Array(buf)))`.
- **Sample rate is the top browser trap.** `new AudioContext({ sampleRate: 24000 })` works on Chromium only. **Firefox** honours the rate but then runs the context outside the graph that feeds its echo canceller — AEC silently dies and the agent interrupts itself. **Safari** ignores the option entirely and runs at the hardware rate (usually 48 kHz), producing chipmunked audio. Cross-browser answer: let the context use its default rate, pass `audioCtx.sampleRate` into the worklet via `processorOptions`, and resample to 24 kHz inside the worklet. Linear interpolation is fine for speech.
- Playback: decode each `reply.audio` `data` chunk to Int16 → Float32, `audioCtx.createBuffer(1, n, 24000)`, and schedule with a running `playbackTime` cursor (`createBuffer` at 24 kHz works on all current browsers; the context resamples on output). On barge-in, **stop the already-scheduled source nodes** and reset the cursor — resetting the cursor alone leaves queued audio playing.
- Flush playback on `input.speech.started` for the snappiest barge-in, and again on `reply.done{status:"interrupted"}`.
- `getUserMedia` and `AudioContext` need a user gesture and a secure origin (HTTPS or `localhost`). `await audioCtx.resume()` before wiring nodes. On iOS Safari use `<audio playsinline>` or route through the AudioContext destination.
- In browsers, pre-handshake failures (e.g. `UNAUTHORIZED`) surface only as a `close` event with code **1006** — no `session.error` payload.

### After the session — recordings, transcripts, webhooks

[session-history](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/session-history). **Every connection is recorded as a session**, with no configuration needed.

- `GET /v1/sessions?status=&agent_id=&limit=&cursor=` — page of sessions, newest first.
- `GET /v1/sessions/{id}` — adds `config` (the configuration as it actually ran) and `artifacts`: three short-lived **pre-signed URLs** (download with no `Authorization` header). They appear only once the session completes. Store the `session_id`, never the URL; re-fetch for fresh links.
  - `audio` — **OGG/Opus, stereo, `left = user, right = agent`**. Split the channels for per-speaker analysis. (Safari can't play OGG; transcode if needed.)
  - `timeline` — the conversation as JSON: per turn `user_transcript`, `user_confidence`, `agent_text`, `status`, `trigger`, `tool_calls[]` (with `arguments`, `result`, `duration_ms`, `is_error`), and **`time_to_first_audio_ms`** — a real, per-turn latency number.
  - `metadata` — format, channels, channel layout, sample rate.
  - Empty arrays are **omitted** from the JSON: a session with no speech has no `turns` key, a turn with no tools has no `tool_calls`. Default them when reading.
- `DELETE /v1/sessions/{id}` — soft delete, `204`.
- [webhooks](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/webhooks) — signed HTTPS callbacks on session/call start, connect and end, carrying recording and transcript URLs.

This is the supported path to **post-call analytics**: pull the recording, then run it through pre-recorded transcription (§6) with `speaker_labels`, `redact_pii`, `redact_pii_audio`, Medical Mode, etc. — all the features the live agent WebSocket does not expose.

### Custom LLM

[connect-your-own-llm](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/connect-your-own-llm). Default is AssemblyAI's managed conversational model, no configuration. To override, set `llm` on a **stored agent** (create or update) — an array with exactly one entry today:

```json
"llm": [{ "base_url": "https://llm-gateway.assemblyai.com/v1", "model": "claude-sonnet-4-6", "api_key": "<ASSEMBLYAI_API_KEY>" }]
```

Pointing `base_url` at the LLM Gateway gives frontier models billed on the AssemblyAI account with no second provider account. Requirements: OpenAI-compatible `POST {base_url}/chat/completions`, **streaming support required**, HTTPS public host only, `api_key` is write-only and never returned. `"llm": []` reverts to managed. Latency becomes your endpoint's problem. **Note the `llm` field is not part of the inline `session.update` schema** — it is a stored-agent field.

### Telephony (SIP / Twilio)

[connect-to-twilio](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/connect-to-twilio), [pre-connect-requests](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/pre-connect-requests). Inbound only: point a Twilio number you own at AssemblyAI over a SIP trunk and attach a stored agent by `agent_id`. You run nothing; Twilio and AssemblyAI move the audio and the carrier handles echo. Setup is ~10 minutes, mostly Twilio config. Use `audio/pcmu` at 8 kHz to avoid resampling. **Pre-connect requests** let you look the caller up in your own systems before the phone is answered.

### Billing

[billing-and-pricing](https://www.assemblyai.com/docs/billing-and-pricing). Voice Agent sessions bill on **WebSocket-open duration**, not on speech — idle time and the 30-second resume grace window are both billable, pro-rated to the second, and concurrent sessions accumulate in parallel. An unclosed session bills until `max_session_duration_seconds`. New accounts get **$50 in free credits** covering Pre-recorded STT, Realtime STT, Voice Agent API, Speech Understanding and Guardrails — **LLM Gateway is excluded** and bills from the balance from the first request. The docs' own pricing table lists only pre-recorded (`universal-3-5-pro` $0.21/hr, `universal-2` $0.15/hr) and streaming (`universal-3-5-pro` $0.45/hr session duration); the **$4.50/hr** Voice Agent figure comes from the marketing pricing page, not the docs.

### Error codes

`session.error` always carries `type`, `timestamp`, `code`, `message`; validation failures add `param`.

| Group | Codes |
|---|---|
| Handshake (WS closes; 1008 / 1011) | `UNAUTHORIZED`, `FORBIDDEN`, `server_error`, `INTERNAL_ERROR` |
| Resume (WS closes, 1008) | `session_not_found`, `session_forbidden`, `session_expired` |
| Agent startup (before `session.ready`) | `agent_init_failed`, `agent_timeout` (no ready within 10 s) |
| Client message (session survives) | `invalid_format`, `invalid_audio`, `invalid_value`, `immutable_field`, `invalid_config`, `agent_id_not_first`, `agent_not_found`, `audio_rate_violation` |
| Live session (1008) | `session_expired` — TTL reached, **no warning event first**; run your own client-side timer |
| Retryable — only these three | `at_capacity`, `concurrency_exceeded`, `internal_error` |

A server-side cancel closes with **1011** and no payload. In browsers, pre-handshake failures appear as close code **1006** with nothing readable.

### When to choose Voice Agent API vs realtime STT + your own LLM/TTS

- **Voice Agent API (this section):** end-to-end conversational agents, fastest to ship, AssemblyAI manages the pipeline. Use when "speech in, speech out" is the whole product.
- **realtime STT + framework (Section 11):** you need a specific LLM *inside* a custom orchestration, custom turn-detection logic, LiveKit/Pipecat/Vapi/Vocode/Retell, or features the managed pipeline doesn't expose — notably **in-stream PII redaction**, **live diarization**, and `llm_gateway` per-turn processing, none of which exist on the Voice Agent WebSocket.

If they're not sure, ask: *do you want to choose your own LLM and TTS, or is a managed pipeline fine?* That single answer routes them.

---

## 11. Voice Agent Framework Configs (realtime STT + your own pipeline)

This section is for developers who are NOT using the Voice Agent API (Section 10) — they're wiring AssemblyAI realtime STT into LiveKit, Pipecat, Vapi, Vocode, Retell, or similar, and bringing their own LLM and TTS.

The defaults will not be good enough. Common tuning:

- **`mode`** — start here. Pick `min_latency`, `balanced`, or `max_accuracy`; it sets sensible turn-detection defaults so you usually don't need to hand-tune the silence bounds at all.
- **`agent_context`** — push your agent's latest spoken (TTS) reply here after each agent turn (via `UpdateConfiguration`). It biases the next user turn's transcription with what the agent just said — a big accuracy win for short replies ("yes", account numbers, spellings).
- **`keyterms_prompt`** — pass proper nouns, product names, and domain terms. For dynamic values (usernames, order IDs), update mid-session via `UpdateConfiguration`.
- **Turn silence bounds** — `min_turn_silence` and `max_turn_silence` (ms), only if `mode` isn't enough. Lower values fire end-of-turn faster but risk cutting speakers off. Higher values reduce false finalizations. Form-filling voice input often wants wider windows.
- **Multilingual** — Universal-3-5 Pro code-switches **natively** across its 18 languages with no config. To pin a single language you have two equivalent options: set `language_code` (e.g. `language_code=es`), or just say so in `prompt` (e.g. `"Transcribe in Spanish."`) — `language_code` is essentially a structured shortcut for the latter. To bias toward mixed-language audio, prompt something like `"Transcribe this. Mixed languages in their own characters."`. (There's no `end_of_turn_confidence_threshold` knob — end-of-turn confidence is binary on U3.5 Pro.)
- **Barge-in / false SpeechStarted** — ambient noise, TTS bleed-through, and PSTN echo can cause spurious `SpeechStarted` events. If the agent is interrupting itself, look here first. `voice_focus` can help suppress background noise server-side; framework-level knobs (e.g., LiveKit's `min_interruption_duration`) often complement, not replace, server-side tuning.
- **Phone audio** — 8 kHz mu-law (`pcm_mulaw` at 8000 Hz) should be sent as-is, not upsampled to 16 kHz. Upsampling degrades accuracy.

When the developer names one of these frameworks, ask about their specific turn-taking and interruption requirements before defaulting.

---

## 12. Browser Patterns

**Never put the API key in client code.**

### Pre-recorded — proxy upload + submit through your server

```javascript
// Next.js route handler (server)
export async function POST(request) {
  const incoming = await request.formData();
  const file = incoming.get('file'); // Blob

  const upload = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
    body: file.stream(),
    duplex: 'half',
  });
  const { upload_url } = await upload.json();

  const submit = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: process.env.ASSEMBLYAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      speech_models: ['universal-3-5-pro', 'universal-2'],
    }),
  });
  return Response.json(await submit.json());
}
```

### realtime — server mints a temp token, client connects directly

```javascript
// Server
export async function GET() {
  const res = await fetch(
    'https://streaming.assemblyai.com/v3/token?expires_in_seconds=60',
    { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } },
  );
  return Response.json(await res.json()); // { token }
}
```

```javascript
// Client
const { token } = await fetch('/api/aai-token').then((r) => r.json());
const ws = new WebSocket(
  `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=universal-3-5-pro&mode=balanced&token=${token}`,
);
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'Turn') console.log(msg.transcript, msg.end_of_turn);
};
```

### Capturing mic audio in the browser

`MediaRecorder` does not emit PCM16. You need an `AudioWorklet` (preferred) or `ScriptProcessorNode` to:
1. Capture raw Float32 samples.
2. Downsample to 16 kHz.
3. Convert Float32 → Int16.
4. Send each ~50 ms chunk as a binary WS frame.

Reference: [AssemblyAI realtime-transcription-browser-js-example](https://github.com/AssemblyAI/realtime-transcription-browser-js-example).

---

## 13. Not Supported / Out of Scope

If a developer asks for any of these, say so directly and propose the closest supported alternative. Do not improvise.

- **On-device / offline STT.** Cloud API only.
- **Voiceprint speaker recognition** — matching a voice to a person from an enrolled database of voiceprints. Not supported. `speaker_labels` only gives anonymous diarization (Speaker A, B, C). If you already know who's in the audio, **Speaker Identification** (`speech_understanding` with `speaker_type: "role" | "name"`, Section 3) can attribute turns to the roles/names you supply — but there's no enrollment/recognition of unknown speakers.
- **Standalone TTS.** Not an AssemblyAI product *as a separate API*. TTS is bundled into the Voice Agent API (Section 10) — if they need just-TTS, point them to a dedicated provider.
- **Voice activity detection as a standalone product.** VAD is internal to the realtime pipeline and surfaced via `SpeechStarted` / turn events, not exposed separately.

---

## 14. Error Handling

### REST (pre-recorded)

- **401** — Missing/invalid Authorization, disabled account, or insufficient balance. Double-check there's no `Bearer` prefix.
- **Transcript `status: "error"`** — Read the `error` field on `GET /v2/transcript/{id}`.
- **Retries** — Exponential backoff on 5xx. For 429, respect the `Retry-After` header.
- **Limits** — `/v2/upload` max 2.2 GB; `/v2/transcript` max 5 GB / 10 hr per file.
- **Scoping** — An API key can only transcribe files uploaded under the same project.

### realtime — handshake

- **HTTP 410** — The old `v2` realtime endpoint is deprecated. Upgrade to `/v3/ws`. This is an HTTP status on the upgrade request, not a WebSocket close code.

### realtime — WebSocket close codes

| Code | Meaning |
|------|---------|
| `1008` | Unauthorized: missing/invalid Authorization or token |
| `3005` | Session cancelled (server-side error) |
| `3006` | Invalid message type / invalid JSON |
| `3007` | Audio chunk outside 50–1000 ms, or sent faster than real-time |
| `3008` | Session expired (3-hour cap) |
| `3009` | Too many concurrent sessions |

### realtime gotchas

- `speech_model` (realtime, singular string) vs `speech_models` (pre-recorded, plural array). Don't mix up.
- On U3.5 Pro realtime, `language_code` **is** honored (pins one of 18 languages); omit it for native code-switching, or steer language in `prompt` instead (e.g. `"Transcribe in Spanish."` — `language_code` is a shortcut for this). There is **no** `end_of_turn_confidence_threshold` knob — end-of-turn confidence is binary.
- Always send `{ "type": "Terminate" }` when finished. An abandoned session stays billable until the 3-hour cap (`3008`).
- Chunk size matters: frames outside 50–1000 ms will close the socket with `3007`.

---

## 15. Quick-Reference Gotchas

- No `Bearer` prefix on the Authorization header — *except* for the Voice Agent API (Section 10), which requires `Authorization: Bearer ...` on the WebSocket and the token endpoint (its REST endpoints accept either).
- Voice Agent API: end with `session.end`, **not** `{"type":"Terminate"}` — `Terminate` belongs to realtime STT (Section 9). Closing the socket without `session.end` leaves a billable 30-second resume window.
- Voice Agent API has **no PII redaction, no diarization, and no `llm_gateway` per-turn hook**. Redaction and diarization live on pre-recorded and raw streaming STT. Post-call analysis goes through `GET /v1/sessions/{id}` → pre-recorded transcription of the recording.
- Voice Agent API recognizes **18** input languages but speaks only **6** (en, es, it, de, pt, fr). `output.voice` is immutable for the session.
- Voice Agent token endpoint: `expires_in_seconds` is **required** (1–600) and tokens are single-use — mint a fresh one per connection, including every resume.
- `speech_models` (pre-recorded) is **optional** — it defaults to `["universal-3-pro", "universal-2"]`, so pass `["universal-3-5-pro", "universal-2"]` explicitly to get the flagship. It's an **ordered fallback list** (plural **array**). Realtime differs: `speech_model` is a singular **string** (`universal-3-5-pro`) and **is required**. Plural array (pre-recorded, optional) vs singular string (realtime, required) is the most common mix-up.
- `universal-3-5-pro` covers 18 languages natively and auto-falls-back to Universal-2 for the rest — no extra config for multilingual audio.
- `prompt` is flexible natural-language guidance on U3.5 Pro (both pre-recorded and realtime): describe the audio and/or steer behavior — e.g. `"Transcribe in Spanish."` to set the language, or `"Transcribe this. Mixed languages in their own characters."` for code-switching. `language_code` is a structured shortcut for the language case.
- `keyterms_prompt` caps differ: up to **1,000** phrases pre-recorded (≤6 words each) vs **100** terms realtime.
- `/v2/upload` takes **raw binary**, not multipart.
- Webhook handlers must return 2xx in ≤10 seconds.
- Local webhook development needs a public tunnel (ngrok, Cloudflare Tunnel).
- Browser code never holds the API key. Proxy uploads, or mint temp tokens for realtime.
- Always `Terminate` realtime sessions.
- Don't use `auto_chapters`, `summarization`, `summary_model`, `summary_type`. Use LLM Gateway.
- Medical mode is `domain: "medical-v1"` (pre-recorded body param / realtime query param). The legacy `medical_mode` flag is **not** the right name.
- LLM Gateway model IDs are exact and versioned (e.g., `claude-sonnet-4-6`, `gpt-5.2`, `gemini-2.5-pro`). Shorthand like `claude-sonnet-4` is invalid.
- Phone audio stays at native 8 kHz mu-law (`encoding=pcm_mulaw`) — don't upsample.
- EU customers use `api.eu.assemblyai.com`, `streaming.eu.assemblyai.com`, and `llm-gateway.eu.assemblyai.com`. The default realtime host (`streaming.assemblyai.com`) is **Edge Routing**, not US-pinned — use `streaming.us.assemblyai.com` if you need data residency guarantees on the US side.
- Speech-model values are **raw strings** in the SDKs (`"universal-3-5-pro"`, `"universal-2"`, `"universal-3-pro"`). Enum aliases like `aai.SpeechModel.universal_3_5_pro` do **not** exist — agents that hallucinate them produce code that imports cleanly and fails at runtime.
- LeMUR has fully sunset (2026-03-31). Don't generate code that calls LeMUR endpoints or passes `transcript_ids` to a chat-completions API — use LLM Gateway with the transcript text in `messages` instead.
