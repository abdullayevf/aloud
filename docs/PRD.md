# PRD — Aloud

**Event:** AssemblyAI Voice Agent Hackathon (lablab.ai × AssemblyAI), 1–30 September 2026. Submissions close **2026-09-30**.
**Status:** v1, written 2026-09-22 (day one of the build) after abandoning a clinic-intake product on the same day. See §9.
**Name:** Aloud

---

## 1. Problem

A deaf, hard-of-hearing or non-speaking person wants to place an ordinary phone call. Every option available to them today puts a stranger inside it, costs the federal government several dollars a minute, or is simply not available.

Federal law has said since 1990 that relay must be **"functionally equivalent"** to a phone call (47 U.S.C. § 225(a)(3)). It is not. The funded options are:

| Option | What happens | Fund cost/min (FY2026-27) |
|---|---|---|
| **VRS** | A sign-language interpreter joins the video call and speaks for you | $4.35 – $8.61 |
| **IP Relay** | You type; a human operator reads your words aloud | $2.2710 |
| **STS** | A trained operator repeats your speech for you | $10.3023 |
| **IP CTS** | You speak for yourself and read captions of the other party | $0.95 (ASR) / $1.45 (human) |
| *Don't call* | — | $0 |

The pattern is exact: **the automated tier stops at the deaf user's ear.** Machines are trusted to caption speech coming *into* the call at $0.95/min. Carrying words *out* of it still costs a human being — and the most expensive line in the entire $1.56 billion program, $10.30/min, is the one for people with speech disabilities.

And IP CTS, the service the Fund spends most of its money on, is defined in regulation as serving *"an individual **who can speak** but who has difficulty hearing over the telephone"* (47 CFR § 64.601(a)(26)). If you do not speak on the phone, the largest relay program in the country was not written for you.

The cost is not abstract. From a US focus-group study of 91 deaf adults:

> **"We just go right to the hospital. I wouldn't call my doctor at all. I just go right to the emergency room."**
> — Steinberg et al., *Journal of General Internal Medicine*, 2006

Full sourcing, including the prior art that already exists: [`docs/research/pitch-stats.md`](research/pitch-stats.md).

---

## 2. Target user

**Primary: a deaf or hard-of-hearing adult who does not use their voice on the phone.** This is the sharpest framing, it carries the statutory mandate (ADA Title IV) and the funding mechanism, and the legal duty of verbatim relay attaches to it directly.

**Named adjacent market: people who cannot rely on speech at all** — AAC users, people with ALS, post-laryngectomy, severe stutter, aphasia. Roughly **4 million Americans** "cannot reliably meet their daily communication needs using natural speech" (National Academies, 2017). Their relay option, STS, is the costliest and least automated service in the program. Everything Aloud does for the primary user works unchanged for them; the product does not need a second mode, only a second sentence in the pitch.

**Demo persona.** A deaf user placing a real-shaped call: rescheduling a clinic appointment. The call opens on an automated phone menu, then reaches a receptionist who has never taken a relay call. Both of those obstacles come straight out of the Steinberg quotes (§1 and pitch-stats §5).

---

## 3. Solution

**Aloud is a relay that runs on one WebSocket and keeps no one else in the call.**

The user types. Their words are spoken aloud on the line, **verbatim** — not paraphrased, not expanded, not "refined." The other party talks; it is captioned live. After every utterance, the screen shows what was typed next to what was actually said in the user's name, checked against the provider's own transcript of the audio it generated.

When the call ends, the recording the provider made is **deleted**, and the user watches that happen.

### 3.1 The inversion that makes it possible

The AssemblyAI Voice Agent API is built for an AI agent to talk to a human. Aloud swaps the two roles:

| API role | Who it actually is in Aloud |
|---|---|
| "user" — microphone in, `transcript.user` / `transcript.user.delta` | **the hearing party** → rendered as live captions |
| "agent" — `reply.audio`, `transcript.agent` | **the deaf user's typed words**, spoken aloud |

One socket, one provider, both directions. Nobody else in the field read the API this way.

### 3.2 Verbatim is built, not prompted

The API composes every reply through a language model, so a prompt asking it to "repeat exactly" would be a request, not a guarantee — and 47 CFR § 64.604(a)(2)(ii) makes verbatim a legal duty, not a preference.

So Aloud registers **its own OpenAI-compatible endpoint** as the agent's `llm` (a documented stored-agent capability). In verbatim mode that endpoint performs no inference at all: it streams back exactly the characters the user typed. The model is not asked to behave; it is removed from the path.

`transcript.agent` then comes back as a **receipt**, and the UI diffs it against the typed text.

Architecture, the request contract and the validation gates are in the design spec: [`docs/superpowers/specs/2026-09-22-aloud-design.md`](superpowers/specs/2026-09-22-aloud-design.md).

---

## 4. Core features (MVP)

Ranked by how directly each earns a judging axis.

### 4.1 Verbatim relay with a receipt — *Originality, Application of Technology*

Type; it is spoken. Every utterance appears in a **ledger** with two columns: **typed** and **spoken (as recorded by the provider)**, plus a match indicator and a running count — *"47 of 47 utterances relayed verbatim."*

This is the product. Not "text-to-speech on a call" — that ships already (§7) — but **the only one that proves it did not change your words.**

### 4.2 Live captions of the hearing party — *Application of Technology*

Partial captions from `transcript.user.delta` (whose `text` is the full transcript so far — replace, never concatenate), finalised on `transcript.user`. This is the half of the problem IP CTS already solves; Aloud has to do it at least as well or the rest does not matter.

### 4.3 Deleted when it ends — *Business Value, Originality*

47 CFR § 64.604(a)(2)(i) forbids a relay provider from keeping the content of a call beyond the call. AssemblyAI records every session automatically. So Aloud calls `DELETE /v1/sessions/{id}` on hangup and shows the user the confirmation.

This is the inverse of what the abandoned product in this repo did, which built a downloadable packet out of the recording. Here the artifact is its absence.

Any post-call keepsake is **opt-in, off by default, and named plainly** if it exists at all.

### 4.4 Speed where speed is the accessibility feature — *Presentation*

Two things get hung up on: silence and slowness.

- **The relay announcement** is spoken the instant the call connects, via `greeting` — the one string in the API that goes straight to TTS without passing through a model, i.e. the one that is verbatim by documentation. "Hello — you're on a relay call. The person you're speaking with is typing. Please talk normally."
- **Quick phrases**, one tap: *"Please repeat that."* · *"Please hold on."* · *"I'm using a relay service — please speak normally."* · *"Yes."* · *"No."*
- **Measured latency**, taken from the session's own `time_to_first_audio_ms` in the timeline artifact, not quoted from a spec sheet.

### 4.5 Assistant mode — navigation only, off by default — *Business Value*

Phone menus are a documented barrier for relay users ("I hate that" — Steinberg et al.). So the same custom endpoint can, on the user's explicit instruction, stop passing through and handle **the machine part of the call**: press 2, wait on hold, answer "what's this regarding?".

Three hard rules, because this is where a product like this goes wrong:

1. **It is off by default and it never turns itself on.**
2. **It never speaks in the user's name.** In assistant mode the agent identifies itself as an automated relay assistant. It does not impersonate the user or invent the user's answers.
3. **The screen is unmistakable about which mode is live**, and the ledger records the mode for every utterance.

This is deliberately narrower than what the market already does — InnoCaption's "AI Refine" expands `make appointment` into a sentence the user did not write (pitch-stats §4.2). Aloud will not do that, and the contrast is the pitch.

### 4.6 When the other party doesn't speak English — *stretch*

The API recognises **18 languages** and speaks **6**. A hearing party speaking any of the 18 is captioned correctly with no configuration (`input.language_codes` is deliberately omitted). Whether the user's typed words can be *spoken* in the other party's language depends on that language being one of the 6. Demonstrate the captioning half; state the limit honestly rather than implying a translator.

---

## 5. Out of scope (v1)

- **Real telephony.** Browser-to-browser demo. Inbound SIP is ~10 minutes of Twilio setup but needs a funded number judges cannot dial, and only the browser gives free acoustic echo cancellation. The same config is published as a stored agent, so "point a number at this `agent_id`" is one step, not a promise. *(Note: the hearing party in the demo is a second browser or a person in the room — see the spec's demo section.)*
- **Being an FCC-certified TRS provider.** Aloud is not eligible for TRS Fund compensation and does not claim to be. It is a demonstration of the mechanism, and — honestly stated — a component any certified provider could adopt to satisfy § 64.604(a)(2)(ii) verifiably.
- **Accounts, call history, contacts.** There is no datastore. That is a feature (§4.3), not a gap.
- **Multi-party calls, voicemail, emergency (911) calling.** 911 over relay carries regulatory obligations this cannot meet. The UI says so rather than failing silently.
- **Sign-language recognition.** Different problem, different product, no path to it in this API.
- **Speech recognition of the user's own voice.** Aloud is text-in by design. A hard-of-hearing person who does speak is already served by IP CTS.

---

## 6. Submission deliverables

Carried forward from the previous PRD, where it came from the user pasting the platform's own guidance — higher trust than a scrape.

- [ ] Project title, short description, long description, technology & category tags
- [ ] Cover image
- [ ] Video presentation
- [ ] Slide presentation
- [ ] Public GitHub repository
- [ ] Demo application platform + live application URL

**Format conventions below are general lablab platform conventions, not this hackathon's published rules** — the hackathon page is client-rendered and does not expose its own rules to a fetch. **Verify against the live submission form before the deadline.**

- Video: MP4, ≤5 minutes, ≤300MB
- Slide deck: PDF
- Cover image: PNG/JPG, 16:9
- Title ≤50 characters · short description ≤255 characters · long description ≥100 words
- Demo hosting: Vercel

Pitch video structure: the person and the problem (0:00–0:45) → live call, captions and ledger (0:45–2:45) → the deletion (2:45–3:15) → the market and the law (3:15–4:15) → roadmap (4:15–5:00).

---

## 7. Originality — stated so it survives a judge who knows this market

**What we do not claim.** Type-to-speak on a live call with the other party captioned **already ships in the United States**, funded by the FCC. InnoCaption launched an AI text-to-speech suite in March 2026; Rylo's own site says "Speak or type to reply." Anyone claiming an empty category here is one search away from being contradicted, and that exact mistake is why this repo pivoted on day one.

**What we do claim**, each line backed in [`pitch-stats.md`](research/pitch-stats.md) §4:

1. **The shipping products rewrite the user's words; this one proves it didn't.** InnoCaption's AI Refine "turns a few words (e.g. 'make appointment') into complete, natural-sounding sentences." Federal law prohibits a relay operator from *intentionally altering a relayed conversation* (47 U.S.C. § 225(d)(1)(G)). Aloud is verbatim **by construction** — an endpoint that cannot paraphrase because it does no inference — and it shows a **per-utterance receipt** checked against the provider's own transcript. No product in this market shows the user that comparison.
2. **It deletes the call in front of you.** § 64.604(a)(2)(i) forbids keeping call content beyond the call. Every commercial provider asserts compliance; none demonstrates it on screen.
3. **The field left the whole category on the table.** The hackathon leaderboard carried **101 submissions and zero accessibility or disability entries** on 2026-09-22 (measured, method in [`hackathon-strategy.md`](research/hackathon-strategy.md) §4). AssemblyAI's own hackathon retrospectives repeatedly single out accessibility framing for praise.
4. **The API is used inside out.** ~60% of the field built vertical intake-and-escalate agents. This one inverts the API's two roles so the "agent" is a human being's typed voice and the "user" is the hearing party — and then bypasses the managed model entirely to guarantee fidelity.

The line that carries the pitch: **everyone else built an agent to talk *to* people. This one exists so someone can be *heard*.**

---

## 8. Success criteria, mapped to the judging axes

Four equal-weight axes: Application of Technology, Presentation, Business Value, Originality.

- **Application of Technology** — a custom `llm` endpoint registered on a stored agent, doing zero inference in verbatim mode; roles inverted; `greeting` used as the one documented verbatim path; `DELETE /v1/sessions/{id}` wired to hangup; latency read from the session timeline rather than asserted. Deployed publicly, with a commit history that shows eight days of building rather than one dump commit.
- **Business Value** — a $1,563,489,843 federal fund with a published rate table, in which the outbound direction of the call still costs $2.27–$10.30 a minute of human time (FCC DA 26-646, 2026-06-30). Aloud automates that direction with a fidelity guarantee the regulation already demands.
- **Originality** — §7.
- **Presentation** — one screen. A person types, a voice says it, the ledger ticks over, the recording is deleted. Legible in ninety seconds with the sound off.

**Done means:** a deployed URL where a stranger can place a call, speak through it without their words being altered, read the other side, watch the receipt match and watch the recording be deleted.

---

## 9. What changed, and why

This repo held a multilingual clinic-intake and triage voice agent, abandoned on 2026-09-22 with no application code written. Three verified reasons: its originality claim ("zero healthcare entries") was false — the leaderboard carried at least six, one of them substantially the same product; its compliance feature was built on a marketing page (in-session PII redaction does not exist on this API); and its multilingual claim overreached.

The lesson that carried over: **check what already exists before claiming the gap.** It is why §7 leads with prior art instead of burying it, and why [`pitch-stats.md`](research/pitch-stats.md) opens with the finding that would have been most convenient to omit.

---

## 10. Open questions

Decisions 1–4 below were **made by the assistant on 2026-09-22** under an explicit instruction from the user to proceed without asking. Each is recorded with its reasoning so it can be reversed cheaply.

1. **Primary user — decided: lead deaf/HoH, name non-speaking users second.** Deaf/HoH carries the statutory mandate and the funding; the non-speaking market is larger in dollars per minute and needs no separate build. *Reversible at the cost of rewording §1, §2 and the deck.*
2. **Does the agent ever speak *for* the user? — decided: no.** Verbatim is the only mode that speaks in the user's name. Assistant mode (§4.5) handles machines, identifies itself as an assistant, and never invents the user's answers. **This is the question to put to someone with lived experience**, and their answer overrides this one.
3. **Demo scenario — decided:** rescheduling a clinic appointment; hearing party speaks English; the call opens on an IVR menu so assistant mode has an honest reason to exist.
4. **Git history — decided: kept.** The two pre-pivot commits stay, and the pivot lands as an honest commit. A day-one pivot with its reasoning in the repo reads as judgment, not as noise. Because history was kept, the pre-pivot tree is an ancestor of `HEAD` and is recoverable without any backup ref; the temporary backup tags were deleted on 2026-09-22.
5. **Repo directory name** — the working directory is being renamed to `aloud/` by the user. The assistant cannot rename the directory it is running in.
6. **Whether InnoCaption's AI Refine can be turned off** — unknown, and it sharpens or softens the §7 contrast. Check before the video is recorded.
7. **Team size** — assumed solo; the implementation plan is sequential and independently reviewable.
