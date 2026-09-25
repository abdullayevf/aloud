# Hackathon strategy research (meta-technique + competitive landscape)

Originally sourced 2026-09-22. **Re-aimed at Aloud on 2026-09-22** after the pivot; §1, §2, §4 and §5 are product-neutral measurements and survived intact. §3 was rebuilt, because the technical levers that mattered to a clinic-intake agent are not the ones that matter to a relay.

This is the reasoning behind the PRD's feature priorities and originality claim — kept separate from [`pitch-stats.md`](pitch-stats.md), which is the sourced numbers for the pitch itself.

## 1. How judges actually score

Four equal-weight axes, confirmed as this hackathon's own stated criteria: **Application of Technology, Presentation, Business Value, Originality.**

- [How to Win an AI Hackathon](https://lablab.ai/guide/how-to-win-an-ai-hackathon) — Application of Technology explicitly means: deploy the demo publicly, keep visible GitHub commit history, make the AI do genuinely novel work (not a bare chatbot wrapper).
- [AI Hackathon Project Ideas](https://lablab.ai/guide/ai-hackathon-project-ideas) — winning ideas solve a problem for one *named, specific* user, ideally one the builders have lived themselves; demo flow stays to three screens maximum.
- [Devpost: how to win, from 5 judges](https://info.devpost.com/blog/hackathon-judging-tips) — the pitch sells the idea nearly as much as the code.
- Fatal mistakes named across sources: **pivoting late**, empty repos with a single final commit, building only for localhost, over-chaining LLM calls with no functional reason.

**All four bite here.** This project pivoted on day one, which is the survivable kind. The other three are addressed structurally: a commit per plan task, a public deployment on day two (forced anyway — the custom LLM rejects loopback hosts), and exactly one LLM call in the whole system, which in the default mode isn't a model at all.

## 2. What AssemblyAI itself rewards

From two of their own hackathon retrospectives:

- [Top Voice AI projects — 2024 hackathon](https://www.assemblyai.com/blog/top-speech-ai-projects-and-winners-at-2024-assemblyai-hackathon) — the grand winner, **Dealty**, won for turning a live phone call into structured, form-ready data: talk → real business artifact.
- [These 7 Voice AI projects just blew us away](https://www.assemblyai.com/blog/these-7-voice-ai-projects-just-blew-us-away) — recurring patterns: latency exploited *functionally* rather than quoted as a spec-sheet brag, **accessibility and inclusion framing praised repeatedly**, domain specialisation over generic assistants, and a "we'd buy this" commercial reaction.

**The accessibility line is the single most useful fact in this file**, and §4 shows the entire field left it on the table.

Aloud's latency story is functional in exactly the way they mean: the extra network hop for the custom LLM should *reduce* reply latency in verbatim mode, because there is no inference to wait for. That is a measured number from the session's own timeline (spec §5.4), not a claim.

## 3. Technical levers, re-aimed at a relay

[Voice Agent Features: What Actually Matters in Production](https://www.assemblyai.com/blog/voice-agent-features) names capabilities that separate competitive agents from toy demos. Re-assessed against what Aloud actually needs:

| Lever | Status on the Voice Agent API | How Aloud uses it |
|---|---|---|
| **`connect-your-own-llm`** | Documented, stored-agent only, streaming required, public HTTPS only | **The headline.** An endpoint that performs no inference is how verbatim stops being a promise. Almost nobody will register a custom LLM at all, and nobody will register one whose purpose is to *not* think. |
| **`greeting` bypasses the LLM entirely** | Documented: the string goes straight to TTS | The relay announcement. It is the one verbatim path the API ships. It was also the last-resort fallback (Path C) if the custom-LLM route failed — not needed: the custom-LLM route works, measured byte-identical end to end on 2026-09-23. |
| **`DELETE /v1/sessions/{id}`** | Documented soft delete, `204` | A retention *feature*, not a compliance chore. The field's compliance entries all *assert* they are careful; this one shows the deletion on screen. |
| Entity-aware turn detection via tool parameter hints | Documented, on by default | **Not used.** Aloud declares no tools. Noted here so nobody re-adds tools to get it. |
| `transcription_mode` by call stage | `min_latency` / `balanced` / `max_accuracy`, mutable mid-session | Left at `balanced`. Captions are the accessibility surface and late captions are a defect. A relay is the one product where `max_accuracy` is the wrong instinct. |
| Async post-call analytics (diarization, PII redaction, sentiment) | Fully available on the session recording | **Deliberately unused.** It is a real lever and it is the wrong one here: the recording is deleted. The one exception is reading `time_to_first_audio_ms` before deleting. |
| Immutable streaming partials / pre-emptive generation | Not exposed — turn detection is managed and semantic | n/a. Do not claim it. |
| `input.language_codes` omission | Documented as right for a mixed-language line | Omitted. The hearing party may speak any of the 18 recognised languages; that is free and worth one sentence, not a feature claim. |

## 4. The competitive field — measured 2026-09-22

Method: the leaderboard page embeds the full submission list as escaped JSON inside its HTML. `curl` the `/live` URL and parse that; the rendered page is useless to a fetch.

```bash
curl -sL "https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live" -o live.html
# unescape \" then regex for {"title":…,"likes":…,"shortDescription":…} objects
```

**Scale:** 101 submissions · 75 drafts still unsubmitted · 1,015 teams · 3,547 participants. Ten submissions landed in the previous 24 hours. Only the **top 50** are exposed with titles, descriptions and like counts — those 50 are the competitive half; the remaining 51 are the zero-engagement tail.

**Categories with zero entries:** accessibility and disability. Searched all 50 for *deaf, hard of hearing, hearing, accessib, sign language, caption, disab, blind, nonverbal, speech impairment, stutter, aphasia*. Every hit was a false positive — `VoiceNova` is computer control, `Relay: Voice Operations for Field Work` is field ops, "ADA" appeared as a substring. Also empty: children/education, agent-to-agent calling, low literacy, civic access.

**Crowded:** vertical intake-and-escalate (~60% of all entries), healthcare (6), compliance/audit (7), field ops & IoT (6), receptionist/booking (5), dev tools (4), translation (2).

**The meta the field converged on is refusal and verifiability.** Representative descriptions, verbatim:

> *"it refuses to write that answer into the clinical record"* · *"it never invents a rate or confirmation"* · *"records whether they understood. Not whether they answered."* · *"The claim intake agent that refuses to guess"* · *"hash-chained audit logs"*

**This is good news, not bad.** Aloud sits inside the meta the field already rewards and takes it further, because for a relay the refusal to paraphrase is a civil-rights matter with a CFR citation rather than a billing one. The others refuse to *fabricate a fact*; this one refuses to *rewrite a person*.

**Leaders by community likes at the scan:** SAUTI AI (11) · Siberia Voice Agent (9) · KiaOra Dispatch (5) · MockMate (5) · AegisVoice OS (4). Most entries sit at 0–2, so votes are weak signal this early — though note both leaders are civic/community or multi-tenant business plays, not consumer toys.

**Re-scan around 27–28 September.** 75 drafts were still landing, and late accessibility entries are the specific thing to look for. Plan Task 13 Step 2 makes this a checklist item with a search-term list.

### 4.1 Re-scan — measured 2026-09-23 (Task 13 Step 2)

Method unchanged: `curl -sL "https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live"`, unescape `\"`, regex for `{"title":…,"likes":…,"shortDescription":…}` objects. HTTP 200, 250,400 bytes. Same caveat as the 2026-09-22 scan: only the **top 50** submissions are exposed with title/description/likes; the rest of the (now larger) field is not readable this way.

**Scale, one day later:** **110 submissions** (▲ +15 in the 24h before the scrape) · **77 drafts in progress** (▲ +6) · **1,037 teams** (▲ +35) · **3,586 participants** (▲ +60). Every count grew from the 2026-09-22 scan (101 / 75 / 1,015 / 3,547) — the field is still filling in, consistent with the "re-scan near the deadline" plan.

**Search run again**, same term list: *deaf, hard of hearing, hearing, accessib, sign language, caption, disab, relay, nonverbal, non-speaking, AAC, speech disability* (plus *blind, stutter, aphasia* carried over from the 2026-09-22 pass) — run programmatically over all 50 exposed titles and all 50 `shortDescription` fields.

**Result: still zero accessibility or disability entries.** The only hit is the same false positive as 2026-09-22 — `Relay: Voice Operations for Field Work`, a field-ops/asset-tracking agent, not a communication-accessibility product; "relay" in its description refers to relaying a field incident through a tool chain, not a telecommunications relay service. No other keyword matched any title or description, in either direction.

**Leaderboard is unchanged at the top.** Same five leaders, same like counts as the 2026-09-22 scan: SAUTI AI (11) · Siberia Voice Agent (9) · KiaOra Dispatch (5) · MockMate (5) · AegisVoice OS (4). Either likes on this leaderboard are near-frozen day to day, or the top slice is stable while new submissions land further down — this scan cannot distinguish the two, since only the top 50 are readable.

**Conclusion for the PRD §7 originality claim:** the "101 submissions and zero accessibility entries" line should be updated to reflect this second measurement — the field has grown to 110 submissions (top-50-of-110 visible) and the accessibility/disability category is still empty. No late entrant has landed in the visible slice. **One more re-scan close to the 2026-09-30 deadline is still worth doing** — 77 drafts remain unsubmitted, and any of them could land in the category.

### 4.2 Re-scan — measured 2026-09-25 (Task 8 Step 6)

Method unchanged: `curl -sL "https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live"`, unescape `\"`, regex the `{"title":…,"slug":…,"teamName":…,"teamSlug":…,"likes":…,"imageLink":…,"shortDescription":…}` objects out of the embedded React-flight payload. 50 objects extracted cleanly (the field order and shape are unchanged from the 2026-09-22/23 scans). Same caveat as both prior scans: only the **top 50** submissions are exposed with title/description/likes — the rest of the field is not readable this way.

**Scale, two days later:** the dashboard's own summary block gives exact totals this time (`initialData` in the page payload), not just the visible-50 count: **148 submissions** (▲ +38 from the 110 measured 2026-09-23) · **77 drafts in progress** (unchanged) · **1,122 teams** (▲ +85) · **3,773 participants** (▲ +187) · **111 total likes** across all submissions. The page's own 24h deltas: +20 submissions, +39 teams, +81 participants, +2 drafts in the 24 hours before this scrape.

**Search run again** over all 50 exposed titles and `shortDescription` fields, same term list as the 2026-09-23 pass plus a few additions: *deaf, hard of hearing, hearing, accessib, sign language, caption, disab, relay, nonverbal, non-speaking, aac, speech disability, blind, stutter, aphasia*.

**Result: zero matches, on any term, in either field.** Not even the `Relay: Voice Operations for Field Work` false positive from the 2026-09-23 scan still appears in the current top 50 — the field has moved on enough in two days that even that near-miss dropped out of the visible slice. **The leaders by likes have changed since 2026-09-23**: SAUTI AI: Voice-to-Action (11) leads, followed by a tie between Siberia Voice Agent (9) and CyberVoice AI (9), then KiaOra Dispatch (5) and MockMate — AI Voice Interview Coach (5).

**Conclusion:** with 38 more submissions landed since the last scan and the field having grown to 148 total (top-50-of-148 visible), the accessibility/disability category is **still empty** in the readable slice. This is the third consecutive scan (2026-09-22, 2026-09-23, 2026-09-25) with the same result — worth stating plainly rather than treating as settled: 98 submissions and an unknown number of the 77 drafts remain unread by this method, and any one of them could contain the category. If a scan close to the 2026-09-30 deadline turns up a hit, say so; do not assume the category stays empty by default.

## 5. Prize pool

$10,000 total ($5k cash + $5k in AssemblyAI credits), per the [hackathon page](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon). Registration stays open for the whole 1–30 September build window.

Separately, a new AssemblyAI account gets **$50 in free credits** covering Voice Agent API, pre-recorded STT, streaming STT, Speech Understanding and Guardrails — **LLM Gateway is excluded** and bills from the balance from the first request. At the marketing-page Voice Agent rate that is roughly 11 hours of agent time, ample provided sessions are closed with `session.end`. A leaked session bills to its duration cap.

For Aloud this splits cleanly: verbatim mode uses only the covered products. Assistant mode is the only thing that touches LLM Gateway, and it is off by default.

## 6. Known gaps in this research

- **No lived-experience input yet.** The single most valuable missing input is a conversation with a deaf, hard-of-hearing or non-speaking person about what placing a call feels like, and whether software should ever speak *for* them (PRD §10.2). One real answer beats every paragraph in this file.
- **The hackathon page is client-rendered** and does not expose judging-axis descriptions or the exact deadline time/timezone to a scripted fetch — re-confirmed 2026-09-22 and again 2026-09-23 (`Ends Sep 30, 2026` is the only date string found anywhere; no time-of-day or timezone appears on the hackathon page, the rules page, or the guidelines article). PRD §6's deliverables list came from the user pasting the platform's own guidance. **Update 2026-09-23 (Task 13 Step 1):** the hackathon page's own "Guidelines" section names the same three submission groups as PRD §6 (basic info / cover image & presentation / app hosting) and the same four judging axes, and links to `lablab.ai/ai-articles/hackathon-guidelines`, which — fetched and grepped directly against its raw HTML, not just summarized — states the exact numbers: title ≤50 characters, short description ≤255 characters, long description ≥100 words, cover image "recommended 16:9 ratio," video presentation "under 300MB and within 5 minutes duration." This is the platform's general guidance article (same one the hackathon page itself points builders to before they submit), not a hackathon-specific rules page — no per-hackathon override was found — so it is the best available verification short of opening the logged-in submission form itself, which needs a human with an account. Slide-deck file format (PDF, per PRD §6) and the deadline's exact time/timezone remain **UNVERIFIED** — neither string appears on any of the three pages checked (hackathon page, hackathon-rules, hackathon-guidelines article). See `docs/SUBMISSION.md` for the full sourcing.
- **Submission descriptions only.** The scan read titles and short descriptions, not demos. If a head-to-head matters near the deadline, watch the specific competitor rather than reading its blurb.
- **No measurement of how the top 50 were chosen** — likes, recency or editorial. It affects how much the "zero accessibility entries" finding generalises to all 101.
