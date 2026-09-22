# Validation gate results — measured 2026-09-22

Source of record for the "Gate results, measured 2026-09-22" block in
[`docs/superpowers/specs/2026-09-22-aloud-design.md`](../superpowers/specs/2026-09-22-aloud-design.md)
§3.2. That spec cited `.superpowers/sdd/2026-09-22-aloud-implementation/task-5-report.md`
for this evidence, but everything under `.superpowers/sdd/` is gitignored
(`.superpowers/sdd/.gitignore` is a bare `*`) — that scratch workspace is
deleted at the end of the SDD process. This file carries the load-bearing
evidence forward into version control so the citation does not dangle.

**Retrieval date for everything below: 2026-09-22.** Run against the live
deployment (`https://aloud-implementation.vercel.app`) with real AssemblyAI
Voice Agent WebSocket sessions.

**What ran which gates:** `scripts/gate-probe.mjs` (committed) covers **G1,
G3, and G4** in its default mode, and **G2** via its `--idle` flag (see the
script's own header comment). **G5** was verified separately, via a one-off
script (curl-equivalent, not committed) that issued
`DELETE https://agents.assemblyai.com/v1/sessions/{id}` directly — it is not
part of `scripts/gate-probe.mjs`, which contains no `/v1/sessions/` call at
all (only a `/v1/agents/{id}` delete, to clean up its own throwaway test
agent).

---

## Environment note: agent-visibility network partition (not one of the five gates, but blocking)

In this run environment, AssemblyAI's Agents REST API and WS gateway were
network-partitioned: an agent created via a request from Vercel's serverless
network was consistently invisible (`404` on GET, absent from `LIST`,
`agent_not_found` on WS `session.update`) to REST/WS calls from the probe
machine's network, and symmetrically the reverse — sustained over 30+ minutes
with no convergence, confirmed with both `fetch` and raw `curl` against
`agents.assemblyai.com` directly (plain `uvicorn` responses, no CDN in the
path). `/api/call` itself was unmodified and not at fault — a fresh agent
created from the *same* network path as the WS connection resolved
immediately.

Diagnostic trail, in order:

1. Confirmed `/api/call` returned the same agent id
   (`agent_c3f272fc587641349666be9912323a44`) on every call, and that id 404s
   when queried directly (`GET /v1/agents/{id}`) from the probe sandbox —
   consistently, across 3+ retries spanning minutes.
2. Suspected Next.js fetch caching on the `create`/`update` calls in
   `ensureAgent()` (they lacked `cache: "no-store"`, unlike the `list` and
   token calls). Added it, redeployed. **Did not fix it** — same dead id
   returned. (This speculative change was later reverted — see below.)
3. Suspected a stale/different `ASSEMBLYAI_API_KEY` in Vercel's production env
   vs `.env.local`. Added a temporary key-fingerprint log (first 4 / last 4
   characters, plus length), deployed, confirmed **identical** key in both
   places (`91d1…86e3`, length 32). Not a key mismatch.
4. Logged the `list` response headers + body from inside the deployed route.
   AssemblyAI's real `uvicorn` server (no CDN) returned
   `agent_c3f272fc…` as a genuinely existing agent, created
   `2026-09-22T08:54:48`, from Vercel's vantage point — while the exact same
   account/key, queried from the probe sandbox at the same moment (via both
   `fetch` and `curl`), showed an **empty** list, and 404 on GET for that same
   id.
5. Created several test agents directly from the sandbox with distinct names
   (`aloud-relay-idempotency-check`, sent twice with byte-identical bodies) —
   got **different** random ids both times, ruling out AssemblyAI-side
   idempotency/caching as an explanation, and confirming AssemblyAI's create
   endpoint is not deterministic.
6. Created an agent named `aloud-relay-gateprobe-sandbox` directly from the
   sandbox and connected a WS to it (also token-minted from the sandbox) —
   this worked immediately: `session.ready`, `reply.audio`, greeting spoken,
   `session.end`/`session.ended` all fired normally.

Conclusion: not a caching bug, not a key mismatch, not AssemblyAI-side
idempotency. It looks like a genuine regional/replica split on AssemblyAI's
backend between requests originating from Vercel's network and requests from
the probe sandbox's network, sustained over 30+ minutes with no convergence.

Both speculative code changes from steps 2–3 (the `cache: "no-store"`
additions and the two diagnostic `console.log` lines) were reverted via
`git checkout -- app/api/call/route.ts`; neither was the actual cause, and
that file's diff against the pre-gate-run committed state was confirmed empty.

**This is a real production risk, not just a probe inconvenience:**
production's real users also connect from outside Vercel's network (browser
demo), so if this partition is systemic rather than a momentary
account/regional fluke, real calls could hit the same `agent_not_found`.
Needs monitoring/retry-with-recreate logic before demo day — out of the
original gate-running session's scope to fix, and still open as of this fix
wave.

The gate probes below worked around the partition by minting the token via
`/api/call` (unaffected — tokens are not agent-scoped) but creating their own
throwaway agent directly, from the same vantage point as the WS connection,
using the exact payload shape of `lib/agent-config.ts`'s `buildAgentPayload()`.

---

## Gate results table

| Gate | Result | Evidence |
|---|---|---|
| **G1** | **FAILED** | `conversation.message {type, role, content}` — sent exactly per the documented shape (verified live against `events-reference.md`), after `session.ready`, with a deliberate 800 ms gap before `reply.create` to rule out a race — **never appeared** in the subsequent `/api/llm/v1/chat/completions` request body, in any of 4 independent sessions: (1) `role:"user"` with the `\u0001SAY\u0001`-sentinel text, (2) `role:"user"` with plain ASCII text, (3) `role:"system"` with plain ASCII text, (4) repeated with the 800 ms delay. Every one of those request bodies contained only the `system` message plus two duplicated `assistant`-role messages holding the already-spoken greeting — confirming `assistant` turns **do** get added to history, but nothing sent via `conversation.message` ever does, regardless of role or content. The narrowed question this gate asked (byte-identity of `content`) is moot: `content` never arrives at all. Path B was **not** built in the gate-running session, per that task's brief — flagged for the controller to decide. |
| **G2** | **PASSED** | With nothing queued (no `conversation.message` sent — true idle — and also, incidentally, in all 4 of G1's failed-injection runs, since the server never saw a pending utterance either way), `reply.create` produced `reply.audio` frames for ~2.4 s but **zero** `transcript.agent` events across 5 separate turns. No words were transcribed as spoken. Minor nuance: audio frames were still streamed for the full ~2.4 s window even though nothing was said (possibly comfort-noise/silence padding) — worth confirming this doesn't hold the channel awkwardly against real barge-in, but it did not vocalise words over the hearing party. |
| **G3** | **Measured, with a caveat** | `reply.create` → first `reply.audio`: **28 ms, 38 ms, 45 ms** across 3 runs (mean ≈ 37 ms). This is real evidence our endpoint responds fast with no inference overhead — but because of G1, every one of those replies had **empty** content (the endpoint's stay-silent path), not an actual echoed utterance. It measures our round-trip overhead, not verbatim-echo synthesis latency end-to-end. Re-measure once G1 is resolved. |
| **G4** | **BLOCKED by G1** | Cannot diff `transcript.agent.text` against sent text — no utterance ever reached our endpoint to be echoed, so nothing was spoken to compare. The phone-number-formatting question (`415 555 0134`) is untested. |
| **G5** | **PASSED** | `DELETE https://agents.assemblyai.com/v1/sessions/{id}` → **204** in **374 ms**, called shortly after `session.ended`. No retry needed. |

**Net effect:** the sentinel-over-`conversation.message` mechanism this
design's stateless server depends on (§3.1) does not deliver text into our
endpoint's request body as tested. G2 and G5 hold. G3's number is real but
not the metric intended. G4 is untested.

---

## Run evidence

### G1/G3/G4 run (`node scripts/gate-probe.mjs https://aloud-implementation.vercel.app`)

Key excerpt (turn 2, the actual sentinel test, after an 800 ms deliberate gap
before `reply.create` to rule out a race):

```
--- turn 2 (sentinel utterance) ---
+8946ms reply.started
G3: reply.create -> first reply.audio = 38 ms
+11444ms reply.done
turn 2 done. sawAgentSpeech = false firstReplyAudioAt = 38ms
```

Corresponding `vercel logs` excerpt for turn 2's
`/api/llm/v1/chat/completions` request body (captured while temporary,
since-removed logging was live in that route):

```json
{"messages":[
  {"role":"system","content":"You are an automated relay assistant on a live phone call. ... "},
  {"role":"assistant","content":"Hello. You're on a relay call. The person you're speaking with types, and I read what they type out loud. Please speak normally. "},
  {"role":"assistant","content":"Hello. You're on a relay call. The person you're speaking with types, and I read what they type out loud. Please speak normally."}
],"model":"aloud-verbatim","stream":true,"stream_options":{"include_usage":true}}
```

No `role:"user"` message anywhere — the
`\u0001SAY\u0001Testing one two three. 415 555 0134.` sentinel sent via
`conversation.message` right before `reply.create` is absent. (The two
duplicated `assistant` messages are AssemblyAI's own record of the
already-spoken greeting — confirming `assistant` turns *do* get added to
history.)

Ran 3 times total (with/without the 800 ms delay); every run's turn-2 body
was shaped identically — system message + duplicated assistant greeting,
never a user message.

**Isolating the cause** (ad hoc scripts, not committed): to rule out the
sentinel's `\u0001` control character being stripped, two more one-off tests
used the exact same probe structure:

- `conversation.message {role:"user", content:"PLAIN TEXT PROBE MARKER 12345"}`
  (no control chars) — same result, no user message in the body,
  `grep -c "PLAIN TEXT PROBE"` on the captured body = 0.
- `conversation.message {role:"system", content:"SYSTEM ROLE PROBE MARKER 67890"}`
  (the other documented role) — same result, 0 occurrences in the body.

This rules out both the sentinel encoding and the role choice as the cause.
The event, as documented and as sent, has no observed effect on the request
body in this environment.

### G2 run (`node scripts/gate-probe.mjs https://aloud-implementation.vercel.app --idle`)

```
--- turn 2 (idle — nothing pending) ---
+8017ms reply.started
G3: reply.create -> first reply.audio = 28 ms
+10429ms reply.done
turn 2 done. sawAgentSpeech = false firstReplyAudioAt = 28ms
```

`sawAgentSpeech` stayed `false` — no `transcript.agent` event fired for
turn 2 in this or any of the 4 other turn-2 runs (all of which were,
incidentally, also empty-content turns because of the G1 finding).
`reply.audio` frames streamed for ~2.4 s before `reply.done`, but no words
were transcribed as spoken.

### G5 (direct one-off script, curl-equivalent — not part of `scripts/gate-probe.mjs`)

```
DELETE https://agents.assemblyai.com/v1/sessions/sess_8dfa0e2f43ca4b0bb43931a58074a652
status 204   elapsed_ms 374
```

Called shortly after that session's `session.ended`. No retry needed.

---

## Concerns carried forward

1. **G1 failed as designed/implemented.** The stateless-server sentinel
   mechanism (spec §3) does not work as tested. Options: build Path B (a
   Task 9 decision), or investigate further whether a different AssemblyAI
   event/shape (something other than `conversation.message`) is the actual
   way to inject text that reaches a BYO-LLM's request body.
2. **The `/api/call` agent-visibility partition is a real production risk**,
   independent of G1. If systemic (not just this account/region/moment), real
   users' browsers — which also connect from outside Vercel's network — could
   get `agent_not_found` on connect. Recommend monitoring, and possibly a
   retry-with-recreate fallback, before demo day.
3. **G3's number isn't the metric the gate intended** (empty-content
   round-trip, not verbatim echo) — needs re-measurement once/if G1 is
   resolved.
4. **G4 is fully untested** — the phone-number-formatting question spec §3.2
   flags is still open.

---

# G1 re-probe — measured 2026-09-22 (second session)

Concern 1 above asked whether *a different event or shape* delivers text into a
BYO-LLM's request body. It does. `reply.create { instructions }` works, and the
text arrives unaltered.

**Method.** Two throwaway scripts, not committed (they depend on a third-party
request bin and are of no further use once the answer is recorded). A throwaway
stored agent's `llm.base_url` was pointed at a `webhook.site` bin configured to
return a valid chat-completions SSE stream, so every reply completed normally
**and the full request body and headers were captured verbatim** — which log
scraping never showed. All probe text was synthetic; no real call content was
involved. The bin was deleted (`204`) and both throwaway agents deleted at the
end of the run.

**Why a bin and not our own deployed route:** this workstation has no `vercel`
CLI and the repo has no git remote, so no new route could be deployed to
capture anything; and `.env.local` carries only the AssemblyAI key (under the
name `ASSEMBLY_AI_API_KEY`), not `ALOUD_LLM_SHARED_SECRET`, so a probe agent
pointed at the live `/api/llm/v1` would have drawn a `401` and been
indistinguishable from a non-delivery.

## What was tested, in one live session

| Variant | Result |
|---|---|
| **A — `reply.create { instructions: <sentinel-wrapped text> }`** | **ARRIVED.** Delivered as the **last** element of `messages`, `role: "system"`, `content` **byte-identical**, no wrapping text added, `U+0001` intact. |
| **B — mid-session `session.update { system_prompt: <text> }`** | **ARRIVED, and rejected as a mechanism.** It *replaces* the stored agent's `system_prompt` (the agent's own `BASELINESYSTEMPROMPT` was gone from every later request) and it is **sticky** — the injected text was still present two turns later. Sticky call content that also destroys the assistant-mode prompt is not usable. |
| **C — `conversation.message { role: "user", content }`** | **ABSENT.** Independent confirmation of the first session's G1 failure, this time against a full captured body rather than a log excerpt. |

**One-shot semantics confirmed.** The variant-A text was present in its own
turn's request body and **gone from the next turn's**. Nothing accumulates,
nothing is re-spoken, and an utterance cannot leak into a later reply.

**Root cause of the `conversation.message` failure (verified 2026-09-22 by
direct `curl` + `grep`, not a summariser):** `conversation.message` is
documented in
[`events-reference.md`](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/events-reference.md)
with a field table and an example, and occurs **zero times** in the 74 KB
machine-readable AsyncAPI contract at
[`api-spec/voice-agent-websocket.md`](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/api-spec/voice-agent-websocket.md),
which specifies all seven other client→server messages in full. `reply.create`
*and its optional `instructions` field* are in that contract, typed, with an
example. The most likely reading — **UNVERIFIED, inference not vendor
statement** — is that `conversation.message` seeds AssemblyAI's own managed
conversation state, which is not what gets assembled into a BYO-LLM's
`messages` array. No claim is made here that the event is broken for its
documented purpose.

## Byte-identity under adversarial input

Five utterances, one live session, each compared byte-for-byte against the
captured `content`:

| Case | Input | Result |
|---|---|---|
| 0 | `Yes — that's my number: 415-555-0134, ext. 22.` (em dash, typographic apostrophe) | IDENTICAL, 46/46 chars |
| 1 | `I said "no". Don't change it. 50% off? £30 & €40.` (quotes, currency, ampersand) | IDENTICAL, 49/49 |
| 2 | `line one\nline two\ttabbed` (newline, tab) | IDENTICAL, 24/24 |
| 3 | `Ω émoji 🎧 ünïcode ①②③` (astral-plane emoji, combining accents) | IDENTICAL, 22/22 |
| 4 | 917-character repeated sentence | IDENTICAL, 917/917 |

All five arrived as the **last** message with `role: "system"`.
**ALL BYTE-IDENTICAL: true.**

## Incidental findings from the captured headers — these matter

The request headers had never been captured before. They disclose the
implementation behind the API:

```
user-agent:              LiveKit Agents/1.5.2 (python 3.13.14)
x-stainless-lang:        python          (the OpenAI Python SDK)
x-stainless-read-timeout: 10.0
x-stainless-retry-count: 0
authorization:           Bearer <llm.api_key>
```

1. **There is a 10-second read timeout on our endpoint.** Irrelevant to
   verbatim mode (no inference, ~37 ms measured) but a hard ceiling on
   assistant mode's LLM Gateway proxy, which must stream its first byte inside
   it.
2. **Retries exist** (`x-stainless-retry-count` is a counter). A slow or failed
   response may be retried — on a relay that risks **the same utterance being
   spoken twice**. Worth handling; not yet measured what triggers it.
3. **No session identifier on the request**, in any header or body field. Header-based
   correlation is therefore not available — the Path B fallback would genuinely
   have needed a per-call agent to correlate. Moot now, but it closes the question.
4. **AssemblyAI appends ~1.2 KB of its own boilerplate to `system_prompt`** —
   instructions about speaking aloud, spelling identifiers digit-by-digit, and
   tool-argument formatting. Our configured prompt is a *prefix* of what the
   model actually receives. Inert in verbatim mode (no model runs); relevant to
   assistant mode. `instructions` content, by contrast, arrives clean with
   nothing appended.
5. **The `greeting` appears as an `assistant` message** in later request bodies,
   with a trailing space (`"Probe session. "`).
6. `U+0001` survives JSON transport intact, so the sentinel encoding is sound.

---

# End-to-end run — measured 2026-09-23

The probes above answered *which mechanism delivers*. This run answers *does the
product work*: the real deployed `/api/llm/v1/chat/completions`, with the new
parser, driven over a real WebSocket session by the committed
`scripts/gate-probe.mjs` (rewritten for `reply.create { instructions }`; it used
to test the dead `conversation.message` path).

`node scripts/gate-probe.mjs https://aloud-implementation.vercel.app`

## G3 — added latency, now measuring the right thing

`reply.create` → first `reply.audio`, with **real echoed content** rather than
the empty replies the first run was stuck with: **28 ms, 29 ms, 30 ms · mean
29 ms.** Concern 3 above is closed. The custom-LLM hop is not a latency risk in
verbatim mode, which is the expected result of running no model.

## G4 — typed against spoken: byte-identical, three for three

`transcript.agent.text` compared against the text sent:

| Typed | Spoken back | Result |
|---|---|---|
| `I'd like to reschedule Thursday's appointment.` | identical | **byte-identical** |
| `My number is 415 555 0134.` | identical | **byte-identical** |
| `Yes — that's right, and please call back after five.` | identical | **byte-identical** |

The phone-number case spec §3.2 flags by name came back unaltered — no
digit-grouping change, no punctuation drift — and so did the em dash and the
typographic apostrophes. The normalising comparison in spec §3.3 is therefore
**belt-and-braces, not load-bearing**: on this evidence the raw strings already
match. Keep the normalisation anyway; one unmeasured TTS path does not justify a
ledger that reports a false mismatch.

## G2 — re-confirmed under the new mechanism

`node scripts/gate-probe.mjs … --idle` → `reply.create` with nothing pending
produced `reply.started` … `reply.done` and **no `transcript.agent` event**.
The agent stays silent when the hearing party speaks and nothing is typed.

## What this leaves open

- **The agent-visibility partition persists, and is now observed on two
  separate days.** On 2026-09-23, `POST /api/call { "recreate": true }` returned
  `agent_95a06b99…` from the deployment, and `GET /v1/agents` from this
  workstation — same account, same key, moments later — returned an **empty
  list**. This is no longer a one-off fluke. The server half of the fix shipped
  (`recreate: true` forces a fresh agent instead of handing back the same
  unreachable id); the client half, retrying on `agent_not_found` with a fresh
  single-use token, is Task 9 and is the top remaining technical risk.
---

# Retry behaviour — measured 2026-09-23

The question: `x-stainless-retry-count` proves AssemblyAI's client retries, so
**can a retry make the agent speak the same sentence twice?** On a relay that
would be unauthorised words in the user's name, so it was worth forcing rather
than leaving as a known unknown.

**Method.** A temporary `app/api/llm-probe/v1/chat/completions` route, deployed
to production, choosing its behaviour from a mode prefix inside the sentinel and
from the incoming `x-stainless-retry-count` — so every decision derives from the
request and the route stays stateless. Four scenarios, each in its own session,
driven by a throwaway agent pointed at the probe route. The real agent was never
pointed at it. Both the route and its script were deleted after the run and the
deletion confirmed (`404`).

| Scenario | What the endpoint did | Attempts seen | Spoken |
|---|---|---|---|
| **FAILFIRST** | `500` on attempt 0, success after | 0, 1 | **once** — `"first scenario on attempt 1"` |
| **FAILALWAYS** | `500` on every attempt | 0, 1, 2 — repeatedly | **not at all**, gave up after ~13 s |
| **SLOWFIRST** | hung 13 s on attempt 0, past the 10 s read timeout | 0, 1 | **once** — `"third scenario on attempt 1"` |
| **PARTIAL** | streamed the content, then killed the stream mid-flight | **0 only** | **once** — `"fourth scenario"` |

## What this settles

1. **Retries are real and confirmed**, not just implied by a header: attempt 1
   succeeded and said so in its own output.
2. **Both a `5xx` and a read timeout past 10 s trigger one.**
3. **The cap is 2 retries — 3 attempts — then it gives up.** Attempt values
   never exceeded 2.
4. **A mid-stream failure after content was delivered triggers no retry at
   all** (PARTIAL logged attempt 0 and nothing else). This is the case that
   could have caused double-speak, and it does not.
5. **No scenario spoke the sentence more than once.** Every outcome was exactly
   once, or silence. Silence is the safe failure for a relay, and total failure
   produces exactly that.

**Why it is safe, structurally:** the retries all happen *before* any audio is
committed to the line, one `reply.create` yields one spoken reply, and our
endpoint is idempotent by construction — a retried request carries the same
sentinel and therefore produces the same text. Nothing needs to be built to
defend against this.

**One caveat on the counts.** The log feed returned each line an even number of
times (2× for three scenarios, 8× for FAILALWAYS), so the absolute counts are
read as relative. FAILALWAYS's higher multiple is consistent with an outer
retry layer above the SDK's own three attempts — it would explain the ~13 s
before it gave up — but that reading is **UNVERIFIED**. What is verified is the
attempt-number ceiling of 2 and, more importantly, that nothing was ever spoken
twice.
