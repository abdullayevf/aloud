# Submission — Aloud

For the AssemblyAI Voice Agent Hackathon (lablab.ai), submissions close **2026-09-30**.

This file is the copy to paste into the live submission form, plus the sourcing for the format limits and the (not-yet-recorded) video script. Read `docs/PRD.md` §6/§7 and `docs/research/pitch-stats.md` before changing any claim in here — the originality line in particular has a documented failure mode in this repo (see PRD §9).

---

## 0. Format limits — verified 2026-09-23 (Task 13 Step 1)

**What was checked:** the live hackathon page at
`https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon` (fetched via WebFetch and `curl`, HTTP 200) does not itself carry format limits — it lists the same three submission groups as PRD §6 (basic info / cover image & video / repo & hosting) and the four judging axes, and links out to the platform's own guidance for the actual "what to submit" flow: `https://lablab.ai/ai-articles/hackathon-guidelines`.

That guidance article was fetched directly (`curl`, HTTP 200, 111,571 bytes) and grepped against its raw HTML — not just summarized by a model — for the exact numbers below. It walks through the real submission form screen by screen ("You will then be guided through a form to fill in the following details…").

| Field | Limit | Source |
|---|---|---|
| Submission Title | **max 50 characters** | `lablab.ai/ai-articles/hackathon-guidelines`, "Project Information" section, retrieved 2026-09-23 |
| Short Description (Summary) | **max 255 characters** | same |
| Long Description | **minimum 100 words** | same |
| Cover Image | **recommended 16:9 ratio** | same |
| Video Presentation | **under 300MB and within 5 minutes duration** — submitted as a *link* to the video, not a direct file upload, per the article's wording ("Provide a link to your video presentation") | same |
| Main Tracks / Technologies | selected from the hackathon's own listed categories / `lablab.ai/tech` | inferred from the guided walkthrough, not independently grepped |
| GitHub Repository, Demo Application Platform, Demo Application URL | required, no stated format limit | inferred from the guided walkthrough, not independently grepped |

These numbers match what PRD §6 already carried forward as "general lablab platform conventions" — this pass confirms they are also what the platform's own guidance article states today, for this account of the flow. It is **not** a login into the actual per-hackathon submission form (that needs a human with an enrolled account), so treat it as strong secondary confirmation, not a screenshot of the form itself.

**Still UNVERIFIED, and not found on any of the three pages checked** (hackathon page, `lablab.ai/hackathon-rules`, `lablab.ai/ai-articles/hackathon-guidelines`):

- **Exact submission deadline time and timezone.** The hackathon page's `<meta>` description says only "Ends Sep 30, 2026" — no hour, no timezone. Do not submit at the last hour assuming any particular cutoff time; submit with margin.
- **Slide deck file format.** PRD §6 carries "PDF" as a general lablab convention; no page checked states a required format for the slide presentation. Use PDF as the safe default, but this is not confirmed for this hackathon.
- **Video file format (MP4).** The guidance article gives a size and duration limit but does not state a required container/codec. MP4 is the safe default; not confirmed.

`lablab.ai/hackathon-rules` itself returned HTTP 200 but its fetched content carried no extractable rule text (title only) — it may be a client-rendered page that needs JS execution to show content, which this environment's fetch does not do. Not used as a source above.

---

## 1. Title (≤50 characters)

**Aloud — verbatim relay with a receipt**

(37 characters, including the em dash — counted programmatically.)

---

## 2. Short description (≤255 characters)

**A phone relay for deaf, hard-of-hearing and non-speaking callers: you type, it's spoken aloud verbatim, the other party is live-captioned, and every utterance is checked against the provider's own transcript — then the recording is deleted, on screen.**

(251 characters, counted programmatically.)

---

## 3. Long description (≥100 words)

A deaf, hard-of-hearing or non-speaking person places an ordinary phone call. They type; their words are spoken aloud on the line, unchanged. The other party talks; it is captioned live. After every exchange, the screen shows what was typed next to what the provider's own system recorded as having been said — a per-utterance receipt, not a promise. When the call ends, the recording the provider made is deleted, and the person watches it happen.

Type-to-speak with live captions on a phone call is not a new idea — it already ships in the United States, funded by the FCC. InnoCaption added an AI text-to-speech suite in March 2026, and Rylo, an FCC-certified relay provider, lets a caller "speak or type to reply." Anyone pitching this as an empty category is wrong, and this project does not make that claim.

What those products do differently is the gap this one is built to close. InnoCaption's own "AI Refine" feature turns a few typed words into "complete, natural-sounding sentences" chosen by a model, not by the caller — and federal relay regulation (47 CFR § 64.604(a)(2)(ii)) requires that a relay carry a conversation verbatim. Aloud registers its own endpoint as the call's language model and, in verbatim mode, that endpoint runs no inference at all — it echoes exactly the characters typed. There is nothing to catch a model rewriting the caller's words in verbatim mode, because there is no model in that path to do it. The transcript AssemblyAI records of what was actually spoken becomes a receipt the caller can check line by line.

The same regulation forbids a relay from keeping a call's content beyond the call. Every provider asserts it complies. Aloud calls the provider's own delete endpoint on hangup and shows the confirmation on screen, instead of asking the caller to take retention on faith.

Built on the AssemblyAI Voice Agent API for the AssemblyAI Voice Agent Hackathon (lablab.ai, September 2026): a browser-to-browser demo, one WebSocket, no third person listening in.

(Word count: 335, counted programmatically — well above the 100-word minimum.)

---

## 4. Tags

**Category / track:** Accessibility, Voice AI, Telecommunications / Relay

**Technology tags:** AssemblyAI Voice Agent API, Real-time Speech-to-Text, Text-to-Speech, Next.js, TypeScript, Vercel, WebSocket

(Pick from the hackathon's actual tag list in the submission form / `lablab.ai/tech` at submission time — the exact allowed tag vocabulary was not independently confirmed in this pass; see §0.)

---

## 5. Video script — NOT YET RECORDED

**Status: this is a script and shot list only. No video file exists yet.** Recording needs a human with a camera, a microphone, the live deployed app (`https://aloud-implementation.vercel.app`), a second person or second browser to play the hearing party, and a live phone-shaped call to place. This agent has none of those and did not attempt to fabricate a recording or claim one exists.

Structure per PRD §6, target run time ≤5:00 (the verified 300MB / 5-minute limit from §0):

### 0:00–0:45 — The person and the problem
- Open on a face, not a screen. State the problem in one or two sentences: a deaf, hard-of-hearing or non-speaking person placing an ordinary phone call today either has a stranger relaying it, or the automated option was never built for them if they don't speak.
- Read (voice-over or on-screen text) the Steinberg et al. 2006 quote: *"We just go right to the hospital. I wouldn't call my doctor at all. I just go right to the emergency room."* — it's sourced in `docs/research/pitch-stats.md` §5 and it's the strongest line available; use it verbatim, cite it on screen (JGIM, 2006).
- Name the demo scenario: rescheduling a clinic appointment, the call opens on an IVR menu, then reaches a receptionist.

### 0:45–2:45 — Live call: captions and the ledger
- Start the call on camera. Show the relay greeting being spoken (the `greeting` field, verbatim by construction).
- Type a sentence, show it spoken aloud on the line (audio audible in the recording), and cut to a **close-up on the ledger** as the "typed" and "spoken (as recorded)" columns populate — per the brief, this and the deletion banner **are the argument**, so give them real screen time, not a quick pan.
- **Force one deliberate mismatch on camera if at all possible** — e.g. type a sentence, then let the hearing party's mic pick up cross-talk or background noise that changes what the provider's transcript records for a turn, or contrive some other honest way to make one row fail to match. Show the ledger's match indicator actually flip to "no match" for that row, not just tick over 100% for the whole take. State on camera, plainly: *"a receipt that can fail is worth more than one that always passes."* If no mismatch can be forced honestly within the take, say so in the video rather than staging a fake one — do not fabricate a mismatch by editing the ledger's displayed text.
- Show the live captions rendering the hearing party's speech in real time.
- Optionally show a quick phrase button (e.g. "Please repeat that") if the demo call needs it to move forward.

### 2:45–3:15 — The deletion
- End the call. **Close-up on the deletion banner/confirmation.** Say plainly what happened: the provider's recording was deleted, this is `DELETE /v1/sessions/{id}`, a documented soft delete — say "deleted," not "erased" or "destroyed" (this repo's own honesty rule).
- If the UI shows a timestamp or session id for the deletion, hold on it long enough to read.

### 3:15–4:15 — The market and the law
- One sentence on the legal duty: 47 CFR § 64.604(a)(2)(ii) requires relay conversations be carried verbatim; § 64.604(a)(2)(i) forbids keeping call content beyond the call.
- Name the prior art on camera, plainly, the way `docs/PRD.md` §7 states it: type-to-speak with captions already ships — InnoCaption, Rylo. The difference is not "we do this and they don't" — it's that this one proves, per utterance, that it didn't alter the words, and proves the recording is gone. Do not let the voice-over imply the category is empty.
- One sentence on cost: the federal relay fund pays $0.95/min for machine-captioned speech coming into a call and $2.27–$10.30/min for a human to carry a disabled caller's words out of it (FCC DA 26-646, 2026-06-30) — cited in `docs/research/pitch-stats.md` §2.1.

### 4:15–5:00 — Roadmap and close
- One sentence each on what's out of scope for this build and why (real telephony/SIP, accounts, sign-language recognition — PRD §5), so the judges see the boundary was chosen, not missed.
- Close on the line from PRD §7: *"Everyone else built an agent to talk to people. This one exists so someone can be heard."*
- Show the deployed URL on screen: `https://aloud-implementation.vercel.app`.

### Recording notes (for whoever records this)
- Do the ledger close-up and the deletion-banner close-up as **separate, deliberate shots**, not incidental background in a wider shot — the brief calls these "the argument," and a rushed video that argues the case only in voice-over undersells the one thing this product can show and others can't.
- Keep the file under 300MB and under 5:00 (§0). If recording longer and trimming, trim from the roadmap section (4:15–5:00) first — the ledger and deletion sections are the ones judging is most likely to remember.
- Caption or subtitle the video if possible — it is, after all, a project about captioning.

---

## 6. Self-review notes

- The long description names InnoCaption and Rylo by name and states plainly that type-to-speak-with-captions already ships — it does not claim or imply an empty category, per PRD §7 and pitch-stats.md §0's explicit instruction not to make that mistake again.
- No sentence here congratulates the product for caring; the copy states what the mechanism does (echoes text, deletes a recording, shows a receipt) rather than praising the product's intentions, per this repo's "agency first" rule.
- Every number in §0 is either sourced to a specific fetched URL with a retrieval date, or marked UNVERIFIED with a reason. Nothing here restates PRD §6's numbers as if they were independently reconfirmed without saying where the reconfirmation came from.
- The video section is marked NOT YET RECORDED in its own heading and its first line — it is a script and shot list, not a video, and no claim in this file implies otherwise.
