# PRD — Multilingual Clinic Intake & Triage Voice Agent

**Event:** AssemblyAI Voice Agent Hackathon (lablab.ai × AssemblyAI), Sept 1–30 2026
**Status:** Draft v1 — assumptions flagged below, cheap to override before build starts
**Working name:** TBD (placeholder: "Intake Copilot")

## 1. Problem

Small clinics (community health centers, urgent care, dental, pediatric) lose significant revenue and put patients at clinical risk through phone-line breakdowns:

- Practices miss **23–42%** of inbound calls; each missed call costs **$125–500**, totaling **$200K–500K+/year** per practice.
- **41%** of calls arrive after hours, when no one is staffed.
- For the **25M LEP (limited-English-proficient) patients** in the US, the problem compounds: clinics either can't serve the call at all, or pay **$1.25–4/min** for a human interpreter — and LEP patients already have higher ED/hospitalization rates tied to poor language access at intake.

Full sourcing: [`docs/research/pitch-stats.md`](research/pitch-stats.md).

## 2. Target user

**Primary:** the front-desk operation at a small, under-resourced clinic (community health center / urgent care) with a meaningful Spanish-speaking (or other LEP) patient population — the person/team who currently either lets calls go to voicemail or pays per-minute for a phone interpreter.

**Demo persona:** a fictional community clinic in a high-LEP state (e.g., Massachusetts or New York, both >30% LEP) fielding an after-hours call from a Spanish-speaking patient.

## 3. Solution

A voice agent that answers the clinic's line, conducts the intake conversation in the caller's language (native code-switching, no manual language selection), extracts structured intake data live, flags urgency for triage, and — as the compliance/differentiation story — handles the call in a way that's consistent with HIPAA's treatment of AssemblyAI as a business associate for PHI.

For the hackathon demo, "the clinic's line" is simulated via a browser microphone rather than real telephony (see open questions — this avoids Twilio/SIP setup inside an 8-day window while still satisfying the "interactive app URL" submission requirement).

## 4. Core features (MVP)

Ranked by how directly each maps to a judging axis (Application of Technology / Business Value / Originality — see §7):

1. **Multilingual intake conversation** — native code-switching (no forced `language_code`), Spanish-primary for the demo script.
2. **Live structured extraction** — name, DOB, reason for visit, insurance, callback number, pulled out via tool-calling as the call progresses and rendered as a visible "intake card" that fills in real-time (this is the Dealty-pattern: AssemblyAI's own 2024 grand winner won on exactly this "talk → structured record" mechanic).
3. **Urgency triage flag** — simple 3-tier classification (routine / same-day / urgent) surfaced as a visible badge, driven by the intake conversation.
4. **Speaker diarization** — handles the common case of a patient calling with a family member/informal interpreter on the line.
5. **PHI-aware framing** — redaction behavior and explicit "processed under AssemblyAI's HIPAA business-associate terms" messaging in the pitch. This is the originality wedge: zero healthcare entries in the current hackathon leaderboard top 10.
6. **ROI overlay in the demo UI** — a small live counter showing $ saved this call (missed-call cost avoided + interpreter-cost avoided), computed from the researched stats. Makes Business Value tangible inside the 2-minute demo window instead of living only in the pitch deck.

## 5. Out of scope (v1)

- Real telephony (Twilio/SIP inbound numbers) — browser-mic demo only.
- EHR integration — the "intake card" is a UI artifact, not a write to a real system of record.
- Actual appointment booking/scheduling — stubbed.
- Auth, multi-tenant, multi-clinic config — single demo persona only.
- Any language beyond Spanish↔English fully scripted for the demo (native code-switching means other languages will *work*, but only Spanish gets a rehearsed demo path).

## 6. Submission deliverables checklist

Confirmed from the hackathon's own "What to submit" guidelines (as pasted by the user, source of truth):

- [ ] Project title, short description, long description, technology & category tags
- [ ] Cover image
- [ ] Video presentation
- [ ] Slide presentation
- [ ] Public GitHub repository
- [ ] Demo application platform + live application URL

General lablab platform conventions found via research (apply unless the actual submission form says otherwise — **verify against the live form before final submission**, these numbers came from lablab's general guide pages, not this hackathon's page specifically):

- Video: MP4, ≤5 minutes, ≤300MB
- Slide deck: PDF
- Cover image: PNG/JPG, 16:9
- Title ≤50 characters, short description ≤255 characters, long description ≥100 words
- Demo hosting: lablab's guide references Streamlit/Replit/Vercel as supported platforms — Vercel is also the most-used platform among current leaderboard entries per the leaderboard tech-tag scan, so it doubles as the safe default and a judge-familiarity win.

Pitch video structure (from research on lablab winning patterns — [How to Win an AI Hackathon](https://lablab.ai/guide/how-to-win-an-ai-hackathon)):
problem (0:00–0:30) → live demo (0:30–2:30) → business case (2:30–4:00) → team/roadmap (4:00–5:00).

## 7. Success criteria

Mapped to the hackathon's stated judging axes:

- **Application of Technology** — visibly uses non-trivial AssemblyAI capabilities (diarization, structured tool-calling extraction, native multilingual, PHI framing), not a bare STT→LLM→TTS wrapper.
- **Business Value** — cites real figures (missed-call cost, interpreter cost, LEP population, market size) and shows a live ROI counter in-demo.
- **Originality** — healthcare/compliance angle is unclaimed in the current top-10 leaderboard.
- **Presentation** — 3-screen demo max, phone-call format is inherently legible in under 2 minutes.

## 8. Open questions / assumptions to confirm

1. **Team size/roles** — assumed solo or small team; tasks in `docs/TASKS.md` are written to be sequential and independently assignable if teammates join.
2. **Demo shape** — assumed browser-mic simulation of a clinic phone line, not real Twilio telephony. Flag if you want to try real inbound calling instead (adds real infra risk with 8 days left).
3. **Working name** — "Intake Copilot" is a placeholder, not chosen.
4. **Target state for the narrative** — defaulting to Massachusetts or New York (>30% LEP) unless you want a different state (e.g., one with personal/team relevance).
