# Hackathon strategy research (meta-technique + competitive landscape)

Sourced 2026-09-22, same research pass that produced the original track recommendation. This is the reasoning behind the PRD's feature priorities and originality claim — kept separate from `pitch-stats.md` (which is pure numbers for the pitch itself).

## How judges actually score (lablab.ai + general hackathon research)

Four equal-weight axes, confirmed as this hackathon's own stated criteria: **Application of Technology, Presentation, Business Value, Originality.**

- [How to Win an AI Hackathon](https://lablab.ai/guide/how-to-win-an-ai-hackathon) — Application of Technology explicitly means: deploy the demo publicly, keep visible GitHub commit history, make the AI do genuinely novel work (not a bare chatbot wrapper).
- [AI Hackathon Project Ideas](https://lablab.ai/guide/ai-hackathon-project-ideas) — winning ideas solve a problem for one *named, specific* user, ideally one the builders have lived themselves; demo flow stays to 3 screens max.
- [Devpost: how to win, from 5 judges](https://info.devpost.com/blog/hackathon-judging-tips) — pitch sells the idea nearly as much as the code; team chemistry is visible in the presentation.
- Fatal mistakes named across sources: pivoting late, empty repos with a single final commit, building only for localhost, over-chaining LLM calls with no functional reason.

## What AssemblyAI itself rewards (from two of their own hackathon retrospectives)

- [Top Voice AI projects — 2024 hackathon](https://www.assemblyai.com/blog/top-speech-ai-projects-and-winners-at-2024-assemblyai-hackathon) — grand winner **Dealty** won specifically for turning a live phone call into structured, form-ready deal data via entity detection: talk → structured record → real business artifact. This is the exact mechanic our `record_intake` tool-calling feature replicates for healthcare (PRD §4, feature 2).
- [These 7 Voice AI projects just blew us away](https://www.assemblyai.com/blog/these-7-voice-ai-projects-just-blew-us-away) — recurring patterns: latency exploited *functionally* (not as a spec-sheet brag), accessibility/inclusion framing shows up repeatedly as something AssemblyAI explicitly praises, domain-specialized knowledge over generic assistants, and a "we'd buy this" commercial-appeal reaction.

## Underused technical levers (from AssemblyAI's own "what actually matters in production" article)

[Voice Agent Features: What Actually Matters in Production](https://www.assemblyai.com/blog/voice-agent-features) names capabilities that separate competitive agents from toy demos — most hackathon entrants won't bother configuring these:

- **Immutable streaming partials with an `utterance` field** — enables starting LLM processing before the caller finishes speaking (pre-emptive generation), rather than waiting for a complete sentence like most naive builds do.
- **Language-locking over continuous re-detection** — detect the language once and hold it; constant re-detection causes more errors than it prevents. (Relevant caveat for our multilingual feature — worth confirming this applies the same way inside the managed Voice Agent API, not just raw realtime STT, before leaning on it in the demo narrative.)
- **Async post-call analytics** (sentiment, PII, speaker ID) run *after* the call, not inline, so they don't cost latency during the conversation — informs why our ROI counter and any deeper analytics should be post-call UI, not real-time-blocking.
- **Sub-500ms CRM/helpdesk integration mid-call** — named as rare and high-value. We don't have a real CRM to integrate with for the demo, but the "intake card filling in live" feature is our version of this same idea: real-time system-of-record behavior, visibly, during the call.

## Competitive landscape at research time (Sept 22, 2026)

101 submissions, 1,013 teams. Top 10 by vote count covered: dispatch/logistics, HR interview coaching, fraud/security, agriculture, consent/legal-tech, WhatsApp receptionist, 3 generic "voice agent" demos. **Zero healthcare entries in the top 10** — this is the basis for the Originality claim in PRD §7. Only the top 10 were visible through the tooling used (leaderboard "Load more" pagination wasn't reachable); if this matters more before final submission, worth a manual check of the live leaderboard for newer healthcare entries that may have appeared since.

## Known gaps in this research

- No qualitative front-desk pain-point quotes (Reddit is blocked to the fetch tool used). If wanted, get this from a real conversation with a receptionist instead of more searching.
- Landscape scan only covers the top 10 of 101 submissions — re-check closer to submission for new entrants in the same vertical.
