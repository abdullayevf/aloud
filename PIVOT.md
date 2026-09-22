# PIVOT — repositioning this repo from Habla to Aloud

**You are executing a repositioning, not a refactor.** Work through this file top to bottom. The last step deletes this file. Do not delete it early, and do not delete it if any phase is incomplete.

**Model:** run this on Opus. The research phases are the point of the exercise; a cheaper model will pad them with plausible-sounding numbers, which is exactly the failure that caused this pivot.

---

## 0. Read this before you touch anything

### What happened

This repo held **Habla**, a multilingual clinic-intake voice agent for the AssemblyAI Voice Agent Hackathon (lablab.ai × AssemblyAI, submissions close **2026-09-30**). It was abandoned on 2026-09-22, on day one, with zero application code written. Three reasons, all verified:

1. Its originality claim — *"zero healthcare entries in the leaderboard"* — was false. The leaderboard carries at least six, including `Voicemed-AI-Agent` ("Aria, a voice-first AI triage nurse… **Bilingual EN/ES · AssemblyAI Voice Agent API**"), which was substantially the same product.
2. Its compliance feature was built on a marketing page. In-session PII redaction **does not exist** on the Voice Agent API.
3. Its multilingual claim overreached. The API recognizes 18 languages but speaks 6.

The replacement is **Aloud**. Same hackathon, same deadline, same API, different product.

### What Aloud is

A deaf, hard-of-hearing or non-speaking person places a phone call. They type; their words are **spoken aloud verbatim**. The other party talks; it is **captioned live**. Every utterance shows what they typed beside what was actually said in their name, verified against the API's own record.

Today their options are a human relay operator sitting inside their private call, a sign-language interpreter on video at high cost, or not calling.

### Your standing orders

- **Trust nothing in the existing docs.** They describe the dead product and at least three of their factual claims were wrong. The only file that survives review is `docs/assemblyai-integration.md` — see §2.
- **Every number you write gets a source and a date.** If you cannot source it, do not write it. If a source is an SEO aggregator blog, go find the primary and say which one you used.
- **Label confidence.** "Verified against X on DATE" or "unverified, needs checking". No bare assertions.
- **Do not invent product decisions.** §6 lists the decisions that belong to the user. Ask; don't guess.
- **Ask the user before any destructive git operation.** Phase 1 contains one.

---

## 1. Verified facts — frozen, do not re-derive

Everything in this section was checked on **2026-09-22** against a primary source. Carry it forward. You may re-verify; you may not quietly contradict it.

### 1.1 AssemblyAI — the constraint that shapes the product

- **AssemblyAI has no standalone text-to-speech.** Their FAQ: *"AssemblyAI does not offer standalone text-to-speech as a separate service."* TTS exists only inside the Voice Agent API pipeline.
  Source: `https://www.assemblyai.com/docs/faq/do-you-offer-voice-to-voice-or-text-to-speech-tts`
- **The only verbatim speech path is `greeting`**, and it is immutable after `session.ready`. The AsyncAPI spec defines exactly 18 events; there is no `reply.say`, no `output.text`, no text-injection path. `reply.create { instructions }` is composed **by the LLM**, not read as a script.
  Source: `/docs/api-reference/specs/voice-agent-api.yaml`, `/docs/voice-agents/voice-agent-api/events-reference.md`
- **`connect-your-own-llm` is the way out.** A stored agent may carry an `llm` array pointing at *your own* OpenAI-compatible endpoint; AssemblyAI calls `POST {base_url}/chat/completions` for **every reply** and speaks what comes back. Requirements: HTTPS public host, **streaming responses required**, exactly one entry accepted today, `api_key` write-only, `"llm": []` reverts to the managed model.
  Source: `/docs/voice-agents/voice-agent-api/connect-your-own-llm.md`
- **Sessions are recorded automatically**, and `DELETE /v1/sessions/{id}` soft-deletes one (returns `204`), after which artifacts become inaccessible.
  Source: `/docs/voice-agents/voice-agent-api/session-history.md`

Everything else about the API — auth, the full `session.update` schema, mutability rules, the event list, tool schemas and the `reply.done` timing rule, browser audio and the Firefox/Safari sample-rate trap, error codes, billing — is already written up and verified in **`docs/assemblyai-integration.md` §10**. Read it. Do not re-research it. Do not rewrite it.

### 1.2 Law and funding — the product's spine

- **Verbatim is a legal requirement for relay.** 47 CFR § 64.604(a)(2)(ii): *"CAs are prohibited from intentionally altering a relayed conversation and, to the extent that it is not inconsistent with federal, state or local law regarding use of telephone company facilities for illegal purposes, must relay all conversation verbatim unless the relay user specifically requests summarization, or if the user requests interpretation of an ASL call."*
  Source: `https://www.law.cornell.edu/cfr/text/47/64.604` (eCFR blocks automated fetches; Cornell LII mirrors it)
- **Relay content may not be retained.** 47 CFR § 64.604(a)(2)(i): TRS providers and CAs are *"prohibited from disclosing the content of any relayed conversation… and… from keeping records of the content of any conversation… beyond the duration of a call."*
  Same source. **This is a design constraint, not a footnote** — see §3.3.
- **FCC TRS Fund is ~$1.6B/year**, and IP-CTS is the lion's share of it. IP-CTS volume grew from 2.4M minutes (2009) to **511.6M minutes (2019)**.
- **FCC Fund Year 2026–27 IP-CTS compensation:** **$0.95/min** for service using only automatic speech technology, **$1.45/min** with a communications assistant, plus a **$0.23** supplemental rate for CA-assisted service.
  Source: FCC 2026-27 TRS Fund Compensation and Contributions Order, `https://www.fcc.gov/consumer-governmental-affairs/fcc-releases-2026-27-trs-fund-compensation-and-contributions-order`
- Statutory basis: **ADA Title IV**.

### 1.3 The competitive field — measured, not guessed

Pulled from the leaderboard page's own embedded JSON on 2026-09-22:

- **101 submissions, 75 drafts still unsubmitted, 1,015 teams, 3,547 participants.** 10 submissions landed in the previous 24 hours.
- Only the **top 50** are exposed with titles, descriptions and like counts. Those 50 are the competitive half; the remaining 51 are the zero-engagement tail.
- **Zero accessibility or disability entries.** Searched the 50 for: deaf, hard of hearing, hearing, accessib, sign language, caption, disab, blind, nonverbal, speech impairment, stutter, aphasia. The only hits were false positives (`VoiceNova` = computer control; `Relay: Voice Operations for Field Work` = field ops; "ADA" as a substring).
- Also empty: children/education, agent-to-agent calling, low literacy, civic access.
- Crowded: vertical intake-and-escalate (~60% of entries), receptionist/booking (5), healthcare (6), compliance/audit (7), dev tools (4), field ops/IoT (6), translation (2).
- **The meta the field converged on is refusal and verifiability.** Representative descriptions: *"it refuses to write that answer into the clinical record"*, *"it never invents a rate or confirmation"*, *"records whether they understood. Not whether they answered."*, *"The claim intake agent that refuses to guess"*, *"hash-chained audit logs"*. Aloud sits inside this meta and takes it further, because for a relay the refusal to paraphrase is a civil-rights matter rather than a billing one.
- Leaders by likes: SAUTI AI (11), Siberia Voice Agent (9), KiaOra Dispatch (5), MockMate (5), AegisVoice OS (4). Most entries sit at 0–2, so votes are weak signal this early.

**Re-scan recipe** (run again around 27–28 Sept — 75 drafts are still landing):
```bash
curl -sL "https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live" -o live.html
# The submission list is embedded as escaped JSON in the HTML. Unescape \" then regex
# for {"title":…,"likes":…,"shortDescription":…} objects. The rendered page is useless.
```

### 1.4 Judging

Four equal-weight axes: **Application of Technology, Presentation, Business Value, Originality.** Prize pool $10,000 ($5k cash + $5k AssemblyAI credits).

AssemblyAI's own hackathon retrospectives repeatedly praise **accessibility and inclusion framing**, latency exploited *functionally* rather than quoted as a spec, domain specialization over generic assistants, and a "we'd buy this" reaction. The accessibility preference is the single most useful fact in this document and the entire field left it on the table.

Named fatal mistakes: pivoting late, a repo with one final dump commit, building only for localhost, chaining LLM calls with no functional reason.

New AssemblyAI accounts get **$50 in free credits** covering Voice Agent API, pre-recorded STT, streaming STT, Speech Understanding and Guardrails (not LLM Gateway). Voice Agent sessions bill on **WebSocket-open duration** including idle time; the $4.50/hr figure is from the marketing pricing page and does **not** appear in the docs' pricing table — say so if you cite it.

---

## 2. File disposition — every path, no exceptions

| Path | Action | Notes |
|---|---|---|
| `docs/assemblyai-integration.md` | **KEEP VERBATIM** | Product-neutral, verified 2026-09-22. The one file that survives. Its single "cardiology consultation" hit is AssemblyAI's own prompting example, not our product. Do not touch it. |
| `docs/superpowers/specs/2026-09-22-clinic-intake-voice-agent-design.md` | **DELETE** | Replaced by a new spec. Delete in Phase 1, *before* writing the new one, so you cannot anchor on it. |
| `docs/superpowers/plans/2026-09-22-habla-implementation.md` | **DELETE** | Same. Note before deleting: its Tasks 1, 3, 4, 5 (token route, PCM codec + capture worklet, playback with barge-in, tool-result queue) are product-neutral plumbing and their *approach* is sound. You may re-derive equivalents. Do not copy its product surface. |
| `docs/PRD.md` | **REPLACE** | New product, new problem, new user, new features, new originality argument. |
| `docs/research/pitch-stats.md` | **REPLACE** | Every number is about missed clinic calls and interpreter rates. None survives. Phase 2 rebuilds it. |
| `docs/research/hackathon-strategy.md` | **REWRITE IN PLACE** | §1 (how judges score), §2 (what AssemblyAI rewards), §4 (the measured field), §5 (prize pool) are product-neutral and **stay**. The lever table and every Habla reference get re-aimed at Aloud. |
| `docs/TASKS.md` | **REPLACE** | New calendar against the new plan. Preserve the standing-risks table format; the risks themselves change. |
| `CLAUDE.md` | **REPLACE** | Project description, reading order, architecture, key decisions, gotchas — all change. Keep the gotchas that are about the API rather than the product. |
| `README.md` | **REPLACE** | Public face of the repo. Judges read it. |
| `docs/research/naming.md` | **CONFIRM GONE** | Already deleted on disk but the deletion is unstaged. Stage it. |
| `.claude/`, `.mcp.json`, `.gitignore`, `.ignore` | **KEEP** | Tooling, product-neutral. Verify with the Phase 7 sweep anyway. |
| `graft/` | **REGENERATE OR DROP** | Its `.cache/` and `.graph/` index the old docs. Stale after this work. Either re-index or remove the cache; do not leave a stale index that answers questions about the dead product. |
| `PIVOT.md` | **DELETE LAST** | This file. Phase 8. |
| Repo directory name `habla/` | **USER ACTION** | You cannot rename the working directory from inside it. Tell the user; do not attempt it. |

---

## 3. The product — what to design against

This is the starting design. It is **recommended, not frozen**. Validate the parts marked ⚠ cheaply before committing to them. Everything in §1 is frozen.

### 3.1 The architecture inversion

The Voice Agent API's two roles map onto relay, swapped. Nobody in the field read the API this way:

| API role | Who it actually is |
|---|---|
| "user" — mic in, `transcript.user` / `transcript.user.delta` | **the hearing party** → rendered as live captions |
| "agent" — `reply.audio`, `transcript.agent` | **the deaf user's typed words**, spoken aloud |

One socket. One provider.

### 3.2 Verbatim by construction

Do **not** build verbatim on prompt engineering. It is a legal requirement (§1.2) and prompts drift.

We host our own OpenAI-compatible endpoint and register it as the agent's `llm`. In verbatim mode it performs no inference at all — it streams back exactly the text the user typed.

```
1. user types            → POST /api/say            server holds it, keyed to this call
2. browser               → {"type":"reply.create"}   over the WebSocket
3. AssemblyAI            → POST our /v1/chat/completions   (streaming)
4. we stream back the typed text, unmodified
5. AssemblyAI TTS speaks it verbatim
6. transcript.agent is the receipt — diff it against what was typed, on screen
```

The same endpoint gives **assistant mode** for free: when the user explicitly delegates, it proxies to LLM Gateway instead of passing through, and the agent handles the IVR menu, the hold music (`execution_mode: "hold"` models this literally) and "what's this regarding?". One toggle, user-controlled, clearly indicated on screen.

**⚠ Validate before building on it** — each is a contract question answerable in one sitting with an API key, not a research project:
- the exact request shape AssemblyAI sends to `/chat/completions`, and whether an empty `content` is accepted when nothing is pending
- correlating AssemblyAI's server-side call back to the right browser session. Recommended: create a **short-lived stored agent per call** whose `base_url` carries a unique path segment, then `DELETE` the agent afterwards. Solves correlation by construction.
- added latency of the extra hop (should be *lower* than a real model in verbatim mode — we return immediately)
- **Decided fallback if the pass-through fails:** session-per-utterance using `greeting`, which is documented-verbatim. Rejected as the primary because the reconnect gap drops the hearing party's speech, and a deaf spot in captions is an accessibility defect. Only fall back if the pass-through is genuinely unavailable.

### 3.3 Retention: the call is deleted when it ends

§1.2 forbids relay providers from keeping conversation content beyond the call. AssemblyAI records **every** session automatically. Therefore Aloud calls `DELETE /v1/sessions/{id}` on hangup and shows the user it happened.

This is a feature, not a compliance chore, and it is the opposite of what the dead product did (it built a post-call packet from the recording — **do not carry that over as a default**). If any post-call artifact exists at all it is opt-in, off by default, and the user is told plainly.

### 3.4 Surface worth designing

Treat as a starting list, not a spec:

- live captions of the hearing party, partial then final (`transcript.user.delta.text` is the **full transcript so far** — replace, never concatenate)
- the typed-vs-spoken verbatim ledger with a running count
- quick phrases — real relay users need speed: *"I'm using a relay service, please speak normally"*, *"please repeat that"*, *"please hold"*
- the relay announcement at call start — `greeting` is verbatim and spoken on connect, which is exactly what it is for
- assistant-mode toggle, unmistakable on screen when it is on
- hold handling
- the language question: the hearing party may not speak English. 18 input languages recognized, 6 spoken. That research is gone from this repo but the fact is in `docs/assemblyai-integration.md` §10 and it still applies here.
- latency, measured from the session's own timeline rather than quoted

### 3.5 Positioning

Lead with access, not with technology. The originality argument is **not** "a voice agent for deaf people" — it is that the entire field built agents to talk *to* people, and this one exists to let someone be *heard*. The verbatim ledger is the proof, and it lands inside the meta the field already rewards.

---

## 4. Phases

Work in order. Each gate must pass before you continue.

### Phase 0 — safety

- [ ] `git status` and confirm the working tree matches §2's expectations.
- [ ] `git tag backup/habla-docs-2026-09-22` so nothing is unrecoverable.
- [ ] Tell the user the tag exists and that they should delete it before making the repo public.

### Phase 1 — purge

- [ ] Delete the two files marked **DELETE** in §2.
- [ ] Stage the already-deleted `docs/research/naming.md`.
- [ ] **Git history.** The repo has two commits, both about the dead product, and is not yet public. Judges reward a visible build history and punish a single final dump commit, so a clean history that begins today and then shows eight days of real work is strictly better than one that opens with a dead product.
      **Ask the user to choose, and do not proceed without an answer:**
      **(a)** orphan-branch reset to one fresh initial commit — recommended, the backup tag makes it reversible;
      **(b)** keep history and land the pivot as an honest commit — also defensible, a day-one pivot is normal.
      This is destructive. Confirm explicitly before running it.

**Gate:** no file on disk describes the dead product except the ones queued for replacement in later phases.

### Phase 2 — research (the substance; do not rush this)

Rebuild `docs/research/pitch-stats.md` from scratch. Every figure carries a source link and a retrieval date. Prefer primary sources; if you use an aggregator, say so and flag it.

Anchors already verified — reuse, cite, do not re-derive: §1.2 in full.

Open questions to answer:

1. **Population.** How many people in the US cannot use a standard voice phone call? Separate deaf, hard-of-hearing, and non-speaking. Go to **NIDCD** and **Gallaudet** directly. Numbers seen in aggregator blogs during the pivot, all **unverified and needing primary confirmation**: ~15% of US adults (~37.5M) report some trouble hearing; ~1M functionally deaf; 250k–500k ASL users. Do not publish these until you have the primary.
2. **The non-speaking population.** AAC users, ALS, cerebral palsy, post-laryngectomy, severe stutter, selective mutism. This is a real adjacent market and nobody serves it by phone. Size it.
3. **Relay economics.** IP-CTS rates are in §1.2. Get the **VRS** rate for contrast (it is much higher — sign-language interpreters on video). Who are the incumbent providers, and what is the market worth?
4. **Prior art — be honest about it.** IP-CTS products exist (InnoCaption, ClearCaptions, CaptionCall). They caption what the *other party* says; the user still speaks for themselves. Establish precisely what is and is not already served, and write the distinction into the PRD. **Do not claim a greenfield that isn't one** — that error is why this pivot happened.
5. **The human cost.** Deaf patients avoid care, miss appointments and report worse outcomes; one survey found 28% left an appointment unclear about their diagnosis; NHS England estimated missed appointments by deaf patients cost up to £15M/year. All of these came from search summaries during the pivot and need primary sources. US-specific equivalents are better for this audience.
6. **One real voice.** Find a first-hand account of what placing a phone call is actually like — a quote, a forum post, a published interview. Your own research file already notes that one real quote beats another statistic in a pitch.

**Gate:** every number in the new `pitch-stats.md` has a source and a date, and anything unverified is labelled as such.

### Phase 3 — PRD

Write `docs/PRD.md`: problem, target user, solution, MVP features ranked against the judging axes, explicit out-of-scope, submission deliverables checklist, success criteria, the originality argument from §3.5, and open questions.

Carry forward the submission checklist from the old PRD — it came from the user pasting the platform's own guidance and is higher-trust than a scrape: project title, short description, long description, technology and category tags, cover image, video presentation, slide presentation, public GitHub repository, demo platform and live application URL. The **format conventions** (MP4 ≤5 min ≤300MB, PDF deck, 16:9 cover, title ≤50 chars, short description ≤255 chars, long description ≥100 words) are generic lablab conventions, not this hackathon's published rules — keep the caveat and the instruction to verify against the live form near the deadline.

**Gate:** user approves the PRD before you write the spec.

### Phase 4 — design spec

Write `docs/superpowers/specs/YYYY-MM-DD-aloud-design.md` using the `superpowers:brainstorming` skill's spec conventions. Cover architecture, the verbatim pass-through and its validation gates, retention and deletion, error handling, the browser audio pipeline, and testing. Open with a short section recording what changed and why, so nobody re-litigates the dead product's assumptions.

Do not restate `docs/assemblyai-integration.md` §10. Link to it.

**Gate:** user reviews and approves the spec.

### Phase 5 — implementation plan

Use the `superpowers:writing-plans` skill. Output to `docs/superpowers/plans/YYYY-MM-DD-aloud-implementation.md`. Bite-sized TDD tasks, exact file paths, real code in every step, expected command output, a commit per task. Assume the implementer has no context and will not read this file.

### Phase 6 — the remaining docs

`CLAUDE.md`, `README.md`, `docs/TASKS.md`, and the rewrite-in-place of `docs/research/hackathon-strategy.md` per §2. Write these **after** the PRD and spec so they describe what actually exists.

### Phase 7 — verification sweep

- [ ] Grep the whole repo, excluding `.git/`, for: `Habla`, `Puente`, `record_intake`, `flag_urgency`, `note_caller_language`, `end_intake`, `intake card`, `urgency badge`, `LanguageLine`, `missed-call`, `LEP`, `limited-English`, `clinic-intake-voice-agent`, `habla-implementation`.
      Expected: **zero hits**, except inside `PIVOT.md` itself.
      Note: `clinic`, `patient`, `appointment` and `interpreter` are **not** banned — a deaf person calling a clinic is a plausible demo, and sign-language interpreters are part of this domain. Only the dead product's identity is banned.
- [ ] Verify every internal markdown link resolves.
- [ ] Verify no doc contradicts §1.
- [ ] Verify `docs/assemblyai-integration.md` is byte-identical to how you found it.
- [ ] Regenerate or remove the `graft/` index.

### Phase 8 — land it, then erase this

- [ ] Commit everything with a clear message.
- [ ] Re-run the Phase 7 grep one final time.
- [ ] **Delete `PIVOT.md`** and commit the deletion.
- [ ] Report to the user: what changed, what the open decisions in §6 still are, and that the `backup/habla-docs-2026-09-22` tag exists and should be deleted before the repo goes public.

---

## 5. Things that will go wrong

- **Anchoring on the dead product.** You will be tempted to keep the intake card because there is a nice plan for it. Delete the old spec and plan in Phase 1, before you write anything new.
- **Re-researching the API.** `docs/assemblyai-integration.md` §10 is verified and complete. Every hour spent re-reading AssemblyAI docs is an hour not spent on Aloud. Append `.md` to any AssemblyAI docs URL to get raw Markdown if you genuinely need more.
- **Claiming a greenfield.** IP-CTS exists. Name it, then say precisely what it does not do.
- **Disability tech written by people outside it.** Agency first: their words, shown verbatim, under their control. If the copy ever sounds like it is congratulating itself for helping, rewrite it.
- **Quietly resurrecting the post-call recording feature.** §3.3. It is now a deletion feature.
- **Building verbatim on a prompt.** §3.2. It is a legal requirement.

---

## 6. Decisions that belong to the user — ask, never assume

1. **Git history** — Phase 1, options (a) or (b).
2. **Primary user.** Deaf/HoH is the sharpest framing and carries the legal mandate and the funding. Non-speaking users (AAC, ALS, post-laryngectomy, severe stutter) are a real adjacent market. Lead with one, name the other — the user picks which.
3. **Does the agent ever speak *for* the user, or only relay what they type?** This decides whether assistant mode exists at all. The user said they can get access to someone with lived experience; **this is the question to ask that person.** It is worth more than any amount of reasoning from the outside.
4. **Demo scenario.** Which call is being placed, to whom, and does the hearing party speak English.
5. **Whether the repo directory should be renamed** from `habla/`.

---

*Delete this file when Phase 8 completes. Not before.*
