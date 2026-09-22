# TASKS — the calendar to 2026-09-30

Deadline: **2026-09-30**. Today is **2026-09-22**. Nine days, one of which is already spent on the pivot.

Plan tasks referenced below are from [`superpowers/plans/2026-09-22-aloud-implementation.md`](superpowers/plans/2026-09-22-aloud-implementation.md).

---

## The shape of the week

Two things must happen early or they wreck everything after them:

1. **Deploy on day one.** The custom LLM requires a public HTTPS `base_url`; private and loopback hosts are rejected. There is no localhost-only phase of this project.
2. **Run the validation gates before building UI.** The whole design rests on five contract questions about what AssemblyAI sends our endpoint. They are answerable in an afternoon with an API key. If G1 fails, the server stops being stateless and a task gets added — better to know on day two than day six.

---

## Day by day

### Day 1 — Mon 22 Sep · pivot and documentation ✅
Kill the previous product. Rebuild the research from primary sources. Write the PRD, the design spec and the implementation plan. **Done.**

### Day 2 — Tue 23 Sep · scaffold, deploy, and the endpoint that is the product
Plan **Tasks 1–3**: Next.js scaffold, `/api/call`, **a live Vercel URL**, the sentinel protocol, the OpenAI SSE encoder and `/api/llm/v1/chat/completions`.

*Done when:* `curl -N -X POST https://<deployment>/api/llm/v1/chat/completions` streams back text you typed into the request, byte for byte.

### Day 3 — Wed 24 Sep · the agent, and the five gates
Plan **Tasks 4–5**: the stored agent with its custom `llm`, then G1–G5 measured and written into the spec.

*Done when:* the spec's §3.2 carries real numbers and real logged request bodies, and you know whether the server can stay stateless. **This is the riskiest day. Do not let it slip.**

### Day 4 — Thu 25 Sep · audio
Plan **Tasks 6–7**: PCM codec, capture worklet, playback with a barge-in flush that actually stops scheduled sources.

*Done when:* you can hear the greeting in the browser and talking over the agent stops its audio mid-word.

### Day 5 — Fri 26 Sep · the receipt and the socket
Plan **Tasks 8–9**: the ledger reducer and the relay client.

*Done when:* the unit suite is green and a scripted call types, speaks, and reports a match.

### Day 6 — Sat 27 Sep · the screen
Plan **Task 10**: captions, composer, quick phrases, ledger, status bar, assistant toggle.

*Done when:* a stranger could place a call with no instructions.

### Day 7 — Sun 28 Sep · deletion, browsers, latency
Plan **Tasks 11–12**: `/api/end`, the deletion banner, Chrome/Firefox/Safari, the expiry warning, and one measured `time_to_first_audio_ms` in the README.

*Done when:* the recording is gone and the browser matrix in `docs/BROWSER-NOTES.md` is filled in — **including the Firefox echo-cancellation check.**

### Day 8 — Mon 29 Sep · rehearse and record
Plan **Task 13** part one: re-scan the leaderboard, re-check the live submission form, write the copy, record the video. Force a deliberate ledger mismatch on camera if you can — a receipt that can fail is worth more than one that always passes.

*Done when:* the video exists as a file, under the real limits from the real form.

### Day 9 — Tue 30 Sep · submit early
Plan **Task 13** part two. Submit with hours to spare, then spend the remainder improving the long description. **Do not be building at 23:00.**

---

## Standing risks

| Risk | Likelihood | Impact | Mitigation | Trigger to act |
|---|---|---|---|---|
| **G1 fails** — the typed text does not reach our endpoint in the request body | Medium | High — the server stops being stateless | Path B is already designed (spec §3.2): per-call agent, `base_url` with a unique path segment, 60-second delete-on-read store | Day 3. If it fails, add the Path B task before Task 9 and cut assistant mode if time is short. |
| **G2 fails** — the agent will not stay silent when nothing is pending | Medium | High — it babbles over the hearing party | Return `" "`; failing that, `output.volume: 0` for suppressed turns (volume is mutable) | Day 3 |
| **Both G1 and G2 fail** | Low | Severe | Path C: one session per utterance using `greeting`, which is verbatim by documentation. Costs a reconnect gap in the captions. | Day 3. Decide the same day; do not carry the uncertainty. |
| **A competitor lands the same product late** | Medium — 75 drafts were still unsubmitted on 2026-09-22 | Medium | The ledger and the deletion remain differentiators; name theirs in the submission rather than being caught by it | Day 8 re-scan |
| **The custom-LLM hop adds real latency** | Low — verbatim returns immediately with no inference | Medium | Measure in G3 on day 3, not on day 8 | Day 3 |
| **Firefox echo cancellation dies** and the agent interrupts itself | Medium — it is the single most common bug in this stack | High on camera | `grep -rn "sampleRate" app lib public` must only find the worklet and `ctx.sampleRate` | Day 7 |
| **A session is left open and bills** | Medium | Low ($50 of credits, ~11h) | `max_session_duration_seconds: 600`, always `session.end`, `pagehide` handler | Continuous |
| **LLM Gateway spend** — excluded from the free credits | Low | Low | Assistant mode is off by default; verbatim costs nothing extra | Continuous |
| **Writing a claim that prior art contradicts** | Medium — it already happened once in this repo | Severe | `pitch-stats.md` §0 and §4 are read before any originality sentence is written | Every time copy is written |
| **Scope creep into a post-call artifact** | Medium — the deleted product had a nice one | High — it contradicts §5 of the spec | Spec §0.1. If you catch yourself designing a transcript export, stop. | Continuous |
| **Solo build, no slack** | Certain | Medium | Days 8–9 are deliberately not build days | Day 6. If the screen is not usable by Saturday night, cut assistant mode and the language beat. |

## What gets cut first, in order

If a day slips, cut in this sequence and do not renegotiate:

1. The stretch language beat (PRD §4.6)
2. Assistant mode (PRD §4.5) — the product is whole without it
3. Quick phrases beyond three
4. The measured latency number (nice, not load-bearing)

**Never cut:** the verbatim ledger, the live captions, or the deletion. Those three are the submission.
