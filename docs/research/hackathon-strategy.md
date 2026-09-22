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
| **`greeting` bypasses the LLM entirely** | Documented: the string goes straight to TTS | The relay announcement. It is the one verbatim path the API ships, and it is also the fallback design (Path C) if the custom-LLM route fails. |
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

## 5. Prize pool

$10,000 total ($5k cash + $5k in AssemblyAI credits), per the [hackathon page](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon). Registration stays open for the whole 1–30 September build window.

Separately, a new AssemblyAI account gets **$50 in free credits** covering Voice Agent API, pre-recorded STT, streaming STT, Speech Understanding and Guardrails — **LLM Gateway is excluded** and bills from the balance from the first request. At the marketing-page Voice Agent rate that is roughly 11 hours of agent time, ample provided sessions are closed with `session.end`. A leaked session bills to its duration cap.

For Aloud this splits cleanly: verbatim mode uses only the covered products. Assistant mode is the only thing that touches LLM Gateway, and it is off by default.

## 6. Known gaps in this research

- **No lived-experience input yet.** The single most valuable missing input is a conversation with a deaf, hard-of-hearing or non-speaking person about what placing a call feels like, and whether software should ever speak *for* them (PRD §10.2). One real answer beats every paragraph in this file.
- **The hackathon page is client-rendered** and does not expose judging-axis descriptions, the exact deadline time and timezone, or submission-format specifics to a scripted fetch — re-confirmed 2026-09-22. PRD §6's deliverables list came from the user pasting the platform's own guidance; the *format* numbers are general lablab conventions. **Verify against the live submission form on day 8.**
- **Submission descriptions only.** The scan read titles and short descriptions, not demos. If a head-to-head matters near the deadline, watch the specific competitor rather than reading its blurb.
- **No measurement of how the top 50 were chosen** — likes, recency or editorial. It affects how much the "zero accessibility entries" finding generalises to all 101.
