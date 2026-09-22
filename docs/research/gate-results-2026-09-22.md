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
