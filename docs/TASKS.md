# TASKS — the calendar to 2026-09-30

Deadline: **2026-09-30**. Written on **2026-09-22**; last updated **2026-09-24**. The build ran ahead of this calendar — Days 4–7 landed by 23 Sep, so everything below the line is verification and submission, not construction.

Plan tasks referenced below are from [`superpowers/plans/2026-09-22-aloud-implementation.md`](superpowers/plans/2026-09-22-aloud-implementation.md).

---

## The shape of the week

Two things had to happen early or they would have wrecked everything after them. **Both are done**, and the second one earned its place:

1. **Deploy on day one.** The custom LLM requires a public HTTPS `base_url`; private and loopback hosts are rejected. There is no localhost-only phase of this project. ✅
2. **Run the validation gates before building UI.** ✅ G1 failed on day one — the mechanism the design was built on does not exist for custom LLMs — and was re-probed and replaced the next morning. Finding that on day six, with the UI already written against it, would have cost the submission.

---

## Day by day

### Day 1 — Mon 22 Sep · pivot and documentation ✅
Kill the previous product. Rebuild the research from primary sources. Write the PRD, the design spec and the implementation plan. **Done.**

### Days 2–3 — done early, on 22–23 Sep ✅
Plan **Tasks 1–5**: Next.js scaffold, `/api/call`, a live Vercel URL, the sentinel protocol, the OpenAI SSE encoder, `/api/llm/v1/chat/completions`, the stored agent with its custom `llm`, and **all five gates measured and closed**.

The gates did not go to plan and that was the point of running them early. G1 failed as designed — `conversation.message` never reaches a custom LLM — and was re-probed and closed via `reply.create { instructions }` instead. G2, G3 and G4 all passed; G4 came back byte-identical. Evidence in `docs/research/gate-results-2026-09-22.md`; the day that was budgeted for this is now slack.

**Two days of slack exist. Spend them on Task 9 and the partition risk, not on scope.**

### Day 4 — audio ✅ done early, 23 Sep
Plan **Tasks 6–7**: PCM codec, capture worklet, playback with a barge-in flush that actually stops scheduled sources.

*Done when:* you can hear the greeting in the browser and talking over the agent stops its audio mid-word.

### Day 5 — the receipt and the socket ✅ done early, 23 Sep
Plan **Tasks 8–9**: the ledger reducer and the relay client.

*Done when:* the unit suite is green and a scripted call types, speaks, and reports a match.

### Day 6 — the screen ✅ done early, 23 Sep
Plan **Task 10**: captions, composer, quick phrases, ledger, turn bar. (The assistant toggle that was listed here was cut on 2026-09-23 — PRD §4.5.)

*Done when:* a stranger could place a call with no instructions.

### Day 7 — deletion, browsers, latency · **partly done**
Plan **Tasks 11–12**: `/api/end`, the deletion banner, Chrome/Firefox/Safari, the expiry warning, and one measured `time_to_first_audio_ms` in the README.

Deletion, the expiry warning and the hardening shipped. **Still open: the browser matrix in `docs/BROWSER-NOTES.md` is PENDING in every cell, and the measured `time_to_first_audio_ms` is not in the README.** Both need a human at a keyboard.

*Done when:* the recording is gone and the browser matrix is filled in — **including the Firefox echo-cancellation check.**

### Day 8 — rehearse and record · **the video is the critical path**
Plan **Task 13** part one: re-scan the leaderboard, re-check the live submission form, write the copy, record the video. Force a deliberate ledger mismatch on camera if you can — a receipt that can fail is worth more than one that always passes.

*Done when:* the video exists as a file, under the real limits from the real form.

### Day 9 — Tue 30 Sep · submit early
Plan **Task 13** part two. Submit with hours to spare, then spend the remainder improving the long description. **Do not be building at 23:00.**

---

## Standing risks

| Risk | Likelihood | Impact | Mitigation | Trigger to act |
|---|---|---|---|---|
| ~~**G2 fails**~~ | — | — | **CLOSED 2026-09-23.** The agent stays silent on empty content: `reply.create` with nothing pending produced no `transcript.agent` event. No volume trick needed. | — |
| ~~**G1 fails**~~ | — | — | **CLOSED 2026-09-23**, via `reply.create { instructions }` rather than the `conversation.message` originally specified, which does not reach a custom LLM at all. Byte-identical, one-shot. Path B not built. | — |
| ~~**Both G1 and G2 fail**~~ | — | — | **CLOSED.** Path C not needed. | — |
| **The agent-visibility partition** — an agent created from Vercel's network is invisible to the user's | Medium — observed once, 30+ minutes, no convergence | High — the call never connects, and it looks like our bug | `/api/call` must treat `agent_not_found` as recoverable and recreate rather than reuse; client re-POSTs and reconnects with a fresh token | Task 9. **This is now the top technical risk.** |
| ~~**AssemblyAI retries and the sentence is spoken twice**~~ | — | — | **CLOSED 2026-09-23**, measured by forcing four failure modes in production. Retries fire on `5xx` and on a read timeout past 10 s, cap at 3 attempts, and never fire mid-stream once content is out. The sentence was spoken exactly once or not at all in every case. Nothing to build. | — |
| **`base_url` path is off by one segment** | Was live in the plan until 2026-09-22 | High — a 404 that looks exactly like the agent going mute | `base_url` ends in `/v1`; a unit test in Task 4 asserts the concatenated URL | Already fixed. Do not "simplify" it away. |
| **A competitor lands the same product late** | Medium — 75 drafts were still unsubmitted on 2026-09-22 | Medium | The ledger and the deletion remain differentiators; name theirs in the submission rather than being caught by it | Day 8 re-scan |
| **The custom-LLM hop adds real latency** | Low — verbatim returns immediately with no inference | Medium | Measure in G3 on day 3, not on day 8 | Day 3 |
| **Firefox echo cancellation dies** and the agent interrupts itself | Medium — it is the single most common bug in this stack | High on camera | `grep -rn "sampleRate" app lib public` must only find the worklet and `ctx.sampleRate` | Day 7 |
| **A session is left open and bills** | Medium | Low ($50 of credits, ~11h) | `max_session_duration_seconds: 600`, always `session.end`, `pagehide` handler | Continuous |
| **LLM Gateway spend** — excluded from the free credits | Low | Low | Assistant mode is off by default; verbatim costs nothing extra | Continuous |
| **Writing a claim that prior art contradicts** | Medium — it already happened once in this repo | Severe | `pitch-stats.md` §0 and §4 are read before any originality sentence is written | Every time copy is written |
| **Scope creep into a post-call artifact** | Medium — the deleted product had a nice one | High — it contradicts §5 of the spec | Spec §0.1. If you catch yourself designing a transcript export, stop. | Continuous |
| **Solo build, no slack** | Certain | Medium | Days 8–9 are deliberately not build days | Day 6. If the screen is not usable by Saturday night, cut the language beat. (Assistant mode, the other thing named here, was already cut on 2026-09-23.) |

## What gets cut first, in order

If a day slips, cut in this sequence and do not renegotiate:

1. The stretch language beat (PRD §4.6)
2. Assistant mode (PRD §4.5) — the product is whole without it
3. Quick phrases beyond three
4. The measured latency number (nice, not load-bearing)

**Never cut:** the verbatim ledger, the live captions, or the deletion. Those three are the submission.
