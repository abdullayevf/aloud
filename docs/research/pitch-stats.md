# Pitch stats — Aloud

Numbers for the pitch, the PRD and the deck. Rebuilt from scratch on **2026-09-22** after the pivot away from the clinic-intake product, whose figures were entirely about a different market.

**Rules this file follows.** Every figure carries a source link and a retrieval date. Primary sources are preferred; where a secondary source is used it says so. Anything unconfirmed is labelled **UNVERIFIED** and must not appear in the deck, the README or the video until it is confirmed.

**Retrieval date for everything below: 2026-09-22**, unless stated otherwise.

---

## 0. Read this first — the finding that shapes the whole pitch

**Type-to-speak plus live captions already ships, commercially, in the United States, funded by the FCC.** InnoCaption added an AI text-to-speech suite in **March 2026**; Rylo is an FCC-certified IP CTS *and* IP Relay provider whose own site says "Speak or type to reply." Details and quotes in §4.

Aloud is therefore **not** a greenfield product, and the pitch must not claim it is. Claiming an empty category on a thin scan is exactly the error that killed the previous product in this repo.

What *is* defensible, and what §4 supports line by line:

1. **The shipping products rewrite the user's words.** InnoCaption's "AI Refine" turns `make appointment` into "complete, natural-sounding sentences." That is an LLM composing speech in a disabled person's name. Federal law forbids a relay operator from intentionally altering a relayed conversation (§1). Aloud's position is not "we also do text-to-speech" — it is **verbatim by construction, with a per-utterance receipt the user can check.**
2. **Retention.** Federal law forbids keeping the content of a relayed call beyond the call. Aloud deletes the provider-side recording at hangup and shows the user it happened (§1.3).
3. **Eligibility.** Every service in §4 is US-only, FCC-certified and eligibility-gated. Aloud is a web page.

---

## 1. The legal spine — primary, statutory

### 1.1 Statute (ADA Title IV, as codified)

47 U.S.C. § 225 — [Cornell LII](https://www.law.cornell.edu/uscode/text/47/225):

- **§ 225(a)(3)** defines telecommunications relay services as "telephone transmission services that provide the ability for an individual who is deaf, hard of hearing, deaf-blind, or who has a speech disability to engage in communication by wire or radio with one or more individuals, in a manner that is **functionally equivalent** …"
- **§ 225(d)(1)(G)** — the FCC's regulations must "prohibit relay operators from **intentionally altering a relayed conversation**."
- **§ 225(d)(1)(F)** — regulations must "prohibit relay operators from disclosing the content of any relayed conversation and from **keeping records of the content** of any such conversation **beyond the duration of the call**."

"Functionally equivalent" is the statutory standard, not a slogan. It is the sentence the product is built to satisfy.

### 1.2 Regulation

47 CFR § 64.604(a)(2) — [Cornell LII](https://www.law.cornell.edu/cfr/text/47/64.604) (eCFR blocks automated fetches; Cornell mirrors the text). Carried forward from the pivot brief, which verified it on 2026-09-22:

- **§ 64.604(a)(2)(ii)** — "CAs are prohibited from intentionally altering a relayed conversation and, to the extent that it is not inconsistent with federal, state or local law regarding use of telephone company facilities for illegal purposes, must **relay all conversation verbatim** unless the relay user specifically requests summarization, or if the user requests interpretation of an ASL call."
- **§ 64.604(a)(2)(i)** — TRS providers and CAs are "prohibited from disclosing the content of any relayed conversation … and … from keeping records of the content of any conversation … **beyond the duration of a call**."

### 1.3 What each existing relay service legally *is*

47 CFR § 64.601 definitions — [Cornell LII](https://www.law.cornell.edu/cfr/text/47/64.601), retrieved 2026-09-22. These matter because they draw the boundary of what is already served:

| Service | Regulatory definition (verbatim, abridged where marked …) |
|---|---|
| **IP CTS** (§ 64.601(a)(26)) | "A telecommunications relay service that permits **an individual who can speak** but who has difficulty hearing over the telephone to use a telephone and an internet Protocol-enabled device via the internet to **simultaneously listen to the other party and read captions of what the other party is saying**." |
| **STS** (§ 64.601(a)(46)) | "A telecommunications relay service that allows individuals with speech disabilities to communicate with voice telephone users through the use of **specially trained CAs** who understand the speech patterns of persons with speech disabilities and **can repeat the words spoken by that person**." |
| **VRS** (§ 64.601(a)(57)) | "A telecommunications relay service that allows people with hearing or speech disabilities **who use sign language** to communicate with voice telephone users through video equipment." |
| **IP Relay** (§ 64.601(a)(27)) | "A telecommunications relay service that permits an individual with a hearing or a speech disability to **communicate in text** using an internet Protocol-enabled device via the internet, rather than using a text telephone (TTY) and the public switched telephone network." |
| **CA** (§ 64.601(a)(13)) | "A person who transliterates or interprets conversation between two or more end users of TRS." |

**The single most useful sentence in this file** is the first four words of the IP CTS definition: *"an individual who can speak."* The largest federally funded relay service in the country is, by regulation, for people who use their own voice. A person who cannot — or will not — speak on the phone is served by STS (a human repeats them), VRS (a human interprets them) or IP Relay (a human voices their text). **In every funded path, a third person is inside the call.**

---

## 2. The money

### 2.1 Fund size and rates — primary, current

FCC **DA 26-646**, released **2026-06-30**, setting compensation and contributions for Fund Year **2026-27** (July 1 2026 – June 30 2027). Text: [docs.fcc.gov/public/attachments/DA-26-646A1.txt](https://docs.fcc.gov/public/attachments/DA-26-646A1.txt). Announcement: [fcc.gov](https://www.fcc.gov/consumer-governmental-affairs/fcc-releases-2026-27-trs-fund-compensation-and-contributions-order).

- **Net TRS Fund revenue requirement: $1,563,489,843** — "an increase of 73 million over the prior Fund year" (¶4, and ordering clause ¶36).
- Gross funding requirement **$1,860,789,843**, against a projected prior-year surplus of **$297,300,000** (¶22, ¶23 n.).
- Carrier contribution factors: **0.02276** for internet-based TRS (IP CTS, IP Relay, VRS), **0.00021** for non-internet-based TRS.

Per-conversation-minute compensation, Fund Year 2026-27 (¶81 and ordering clause ¶35):

| Service | Rate |
|---|---|
| **IP CTS — automatic speech recognition only** | **$0.95** |
| **IP CTS — with a communications assistant** | **$1.45** |
| IP CTS — CA supplemental rate (CA paid ≥ **$18.38/hr**) | **+$0.23** |
| **VRS** — provider with ≤1M monthly minutes | **$8.61** |
| VRS — Tier I (first 1M monthly minutes) | $6.96 |
| VRS — Tier II (monthly minutes above 1M) | $4.35 |
| VRS — Video-Text additive | +$0.22 |
| Traditional (TTY) TRS | $9.1713 |
| **Speech-to-Speech (STS)** | **$10.3023** |
| Captioned Telephone Service (CTS) | $3.3885 |
| IP Relay | $2.2710 |

**The spread is the business case.** Captioning a call with machines costs the Fund **$0.95/min**. Putting a human interpreter in it costs **$4.35–$8.61/min**. Putting a human in it for a person with a speech disability costs **$10.30/min** — the most expensive line in the entire program, serving the smallest population, and the one with no automated tier at all.

### 2.2 Growth — **secondary, flagged**

IP CTS demand grew from **2.4 million minutes in 2009** (first full calendar year of service) to **511.6 million minutes in 2019**. Reported by [The Regulatory Review, 2019-09-24](https://www.theregreview.org/2019/09/24/may-reforming-fccs-captioned-telephone-service-program/) and the [Free State Foundation, 2019-09-03](https://freestatefoundation.org/wp-content/uploads/2019/09/Reforming-the-FCCs-Internet-Protocol-Captioned-Telephone-Service-Program-090319.pdf), both citing FCC Fact Sheet **DOC-360521A1** (2019-10-29).

**Status: UNVERIFIED against the primary.** The FCC publishes that fact sheet only as a PDF whose text layer would not extract on 2026-09-22, and the `.txt` mirror returns 404. Use the 2026-27 Fund figures in §2.1 for anything load-bearing; use this growth line only as colour, with the secondary source named.

Also from the same secondary sources, same caveat: IP CTS provider compensation for 2018-19 was projected at "almost $900 million."

---

## 3. Who cannot use a standard voice phone call

### 3.1 Deaf and hard of hearing

- **~11 million people** — "about 3.6% of the U.S. population, or about 11 million individuals, consider themselves deaf or have serious difficulty hearing," per the **2021 American Community Survey**. [National Deaf Center knowledge base](https://help.nationaldeafcenter.org/article/51-how-many-deaf-people-live-in-the-united-states), page last updated 2026-05-10.
  - A more recent NDC figure of **3.8% / 12.8 million (ACS 2024)** appeared in a search summary on 2026-09-22 but **could not be confirmed on an NDC page** — **UNVERIFIED**, do not publish. Use 11M / ACS 2021.
- **37.5 million adults (~15%) report some trouble hearing** — NIDCD, [Quick Statistics About Hearing, Balance, & Dizziness](https://www.nidcd.nih.gov/health/statistics/quick-statistics-hearing), page last updated 2024-09-20, citing the **2012 National Health Interview Survey**. The same page notes that **fewer than 2% of adults who report any trouble hearing are deaf**, which is why "37.5 million" is the wrong number for this product and 11 million is closer to right.
- **Gallaudet Research Institute** estimates (~1 million functionally deaf, ~10 million hard of hearing; 2–4 per 1,000 deaf) are widely quoted. `research.gallaudet.edu` **did not resolve** on 2026-09-22 (DNS failure). **UNVERIFIED — do not publish.** The peer-reviewed origin is Mitchell, R. E. (2006), "How Many Deaf People Are There in the United States? Estimates From the Survey of Income and Program Participation," *Journal of Deaf Studies and Deaf Education* 11(1):112–119 — [PubMed 16177267](https://pubmed.ncbi.nlm.nih.gov/16177267/) (abstract not machine-retrievable on 2026-09-22; cite only after reading it).

### 3.2 People who cannot rely on speech

- **~4 million people (1.3% of Americans)** "cannot reliably meet their daily communication needs using natural speech." National Academies of Sciences, Engineering, and Medicine, *The Promise of Assistive Technology to Enhance Activity and Work Participation* (2017), p. 210, citing Beukelman & Mirenda (2013). [nationalacademies.org](https://www.nationalacademies.org/read/24740/chapter/8). **This is the primary to use for the non-speaking market.**
- **More than 3 million Americans (~1%) stutter.** NIDCD, [Quick Statistics About Voice, Speech, Language](https://www.nidcd.nih.gov/health/statistics/quick-statistics-voice-speech-language), page last updated 2025-07-08 (source dated 2013). As many as 1 in 4 children who stutter continue into adulthood.
- **~2 million Americans have aphasia**, with nearly 180,000 acquiring it each year. Same NIDCD page.
- **17.9 million US adults (7.6%) reported a voice problem in the past 12 months** (2014 data); 9.4 million (4.0%) lasting a week or longer (2012 data). Same NIDCD page. This is a much broader category than "cannot use the phone" — do not conflate.
- **~33,000 people living with ALS in 2022**, projected to exceed **36,000 by 2030**. CDC [National ALS Registry](https://www.cdc.gov/als/php/abstracts-publications-reports/prevalence-2022-2030.html), page last reviewed 2026-09-10.

**And the honest caveat, which is itself a finding.** CommunicationFIRST's AAC Counts project states: *"People in the United States who cannot rely alone on speech to be heard and understood are **not counted in any systematic manner** by federal or state governments,"* and that available data are "based on disability prevalence rates, not population estimates." [communicationfirst.org/aac-counts](https://communicationfirst.org/aac-counts/). The American Community Survey's six disability questions do not include a speech question at all. Say this out loud in the pitch — an uncounted population is a stronger line than a precise-sounding one that isn't.

---

## 4. Prior art — what already ships

**Read this section before writing any originality claim.**

### 4.1 IP CTS — captions of the other party, free to eligible US users

Funded at $0.95–$1.45/min from the TRS Fund (§2.1), so free at the point of use for people who certify eligibility.

| Product | What it is |
|---|---|
| **InnoCaption** | App-first iOS/Android IP CTS. Offers both ASR captions and live CART stenographers on the same call. [innocaption.com](https://www.innocaption.com/) |
| **CaptionCall** (Sorenson) | Captioned desk phone plus app. [sorenson.com/captioncall](https://sorenson.com/captioncall/) |
| **ClearCaptions** | Captioned phone service and app. [clearcaptions.com](https://clearcaptions.com/) |
| **Rylo** | Newer app; describes itself as "an FCC-certified captioned telephone service **and IP Relay provider**." [rylo.com](https://rylo.com/) |

### 4.2 The direct overlap — type-to-speak already exists

**InnoCaption text-to-speech**, announced **2026-03-12** ([company news](https://www.innocaption.com/recentnews/tts-shortcuts-communicate-what-you-need-faster), [help centre](https://help.innocaption.com/en/articles/9236789-use-text-to-speech-tts), [trade coverage](https://hearinghealthmatters.org/hearing-technologies/2026/innocaption-ai-text-speech/)):

- Users "type what they want to communicate and have a clear, natural-sounding voice speak it aloud to the person on the other end of the call."
- **QuickSpeak** — pre-written phrases spoken instantly on tap, e.g. "Please repeat that again."
- **Saved Phrases** — stored text (an address, say) inserted into the input field and editable before speaking.
- **AI Refine** — *"Turns a few words (e.g. 'make appointment') into complete, natural-sounding sentences with a single tap, helping users stay present in the conversation instead of focusing on typing."* ([announcement](https://www.innocaption.com/recentnews/innocaption-launches-ai-refine-smoother-text-to-speech-calls), 2026-03-12). Whether it can be switched off is **not stated on that page — UNVERIFIED.**
- **AI Practice Calls** — rehearsing calls against AI personas.

**Rylo**: "Speak or type to reply. Use your voice or your device's keyboard — the call is yours."

So: *typed words spoken aloud on a live call, with the other party captioned, is a shipping 2026 product in this market.* Aloud must be argued on **how** it does it, never on **whether** anyone does it.

### 4.3 Where a human is still in the call

- **VRS** — an ASL interpreter (a CA) is in the video call, at $4.35–$8.61/min of Fund money. Providers: Sorenson, ZP Better Together, Convo.
- **IP Relay** — the user types; a CA reads it aloud to the hearing party. $2.2710/min.
- **STS** — a specially trained CA repeats the words of a person with a speech disability. $10.3023/min. State programs note that STS users may use their own voice **or an AAC device** (e.g. [Arizona Commission for the Deaf and Hard of Hearing](https://www.acdhh.org/telecommunications/relay-services/speech-to-speech/)).

### 4.4 What is therefore genuinely unserved

Stated narrowly, so it survives contact with a judge who knows this market:

1. **No shipping relay product proves it did not alter the user's words.** One of them advertises altering them as a feature. Verbatim is a legal duty under § 225(d)(1)(G) and § 64.604(a)(2)(ii); no product shows the user a per-utterance comparison of *typed* against *spoken as recorded by the provider*.
2. **No shipping relay product shows the user its recording being deleted** at the end of the call, against a rule (§ 64.604(a)(2)(i)) that forbids keeping call content at all.
3. **The automated tier stops at the deaf user's ear.** The Fund pays $0.95/min for machine captions *into* the call and $2.27–$10.30/min for a human to carry words *out* of it. Automating the outbound direction is where the money and the privacy both are.
4. **Everything here is gated.** US only, FCC-certified providers only, eligibility certification required, tied to a phone number. A browser page with no sign-up serves people the funded system does not reach — including, bluntly, anyone outside the United States.

---

## 5. The human cost — primary, US, peer-reviewed

**Steinberg, A. G., Barnett, S., Meador, H. E., Wiggins, E. A., & Zazove, P. (2006).** "Health Care System Accessibility: Experiences and Perceptions of Deaf People." *Journal of General Internal Medicine* 21(3):260–266. doi:[10.1111/j.1525-1497.2006.00340.x](https://doi.org/10.1111/j.1525-1497.2006.00340.x) · [full text on PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC1828091/).

US study. Focus groups with **91 deaf adults** who communicate primarily in ASL, in Philadelphia, Rochester and Ann Arbor. Findings: "communication difficulties were ubiquitous"; "fear, mistrust, and frustration were prominent."

Participant quotes, verbatim:

> **"We just go right to the hospital. I wouldn't call my doctor at all. I just go right to the emergency room."**

> "the nurse is usually afraid because she has no experience with relay service … I've gotten so many … [telephone] hang-ups"

> On automated phone menus that require pressing buttons during a relay call: "I hate that"

Three product requirements fall directly out of those three quotes: the call has to be **answerable without the hearing party understanding relay**, it has to **survive an IVR menu**, and it has to be **fast enough not to get hung up on**.

**Non-US supporting study, labelled as such:** Tannenbaum-Baruchi, C., Feder-Bubis, P., & Aharonson-Daniel, L. (2025). "Communication barriers to optimal access to emergency rooms according to deaf and hard-of-hearing patients and health care workers: A mixed-methods study." *Academic Emergency Medicine* 32:246–259. doi:[10.1111/acem.15037](https://doi.org/10.1111/acem.15037) · [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11921078/). **Israel**, 288 DHH patients surveyed. Only **28.8%** reported being able to communicate independently with ER staff; 65% named communication as a barrier; over 80% of health-care workers had received no training in communicating with DHH patients. Useful as corroboration; **do not present as a US figure.**

### 5.1 Claims that did *not* survive checking

These circulated during the pivot and are **not** sourced. Do not use them anywhere:

- "28% of deaf patients left an appointment unclear about their diagnosis" — origin unknown, **UNVERIFIED**.
- "NHS England estimated missed appointments by deaf patients cost up to £15M/year" — origin unknown, **UNVERIFIED**, and UK-specific in any case.

---

## 6. One real voice

The pitch opens on a person, not a number. Use the Steinberg quote:

> **"We just go right to the hospital. I wouldn't call my doctor at all. I just go right to the emergency room."**
> — participant, Steinberg et al., *Journal of General Internal Medicine*, 2006

It is peer-reviewed, American, first-hand, and it names a concrete cost: an emergency-room visit substituting for a phone call.

**Still wanted, and better than any of the above:** a conversation with a deaf, hard-of-hearing or non-speaking person about what placing a call actually feels like today, and specifically whether they would ever want an agent to speak *for* them. That question is in the PRD's open questions and it is worth more than another statistic.

---

## 7. Figures we deliberately do not use

- **"$4.50/hr" for the AssemblyAI Voice Agent API.** It appears on AssemblyAI's marketing pricing page but **not** in the docs' pricing table. If it is cited, cite it as a marketing figure. See [`../assemblyai-integration.md`](../assemblyai-integration.md) §10, Billing.
- **Total addressable market figures for "voice AI".** Aggregator market-research headlines, unsourceable to a primary, and irrelevant to a relay product whose funding mechanism is a federal rate table.
- **Anything about unanswered clinic phone lines, spoken-language interpreter pricing, or populations with limited English proficiency.** Those numbers belonged to the product this repo abandoned on 2026-09-22. None of them applies to a relay.

---

## 8. Known gaps

1. **IP CTS minutes growth** (§2.2) is secondary-sourced. Primary is an FCC PDF that would not text-extract.
2. **Provider market shares** — Rolka Loube's annual TRS Fund report contains per-provider payment data; the ECFS document endpoint returned **403** to automated fetches on 2026-09-22. Cited in DA 26-646 ¶9 as CG Docket Nos. 03-123 and 10-51, filed 2026-05-04.
3. **No US figure for how many relay calls are hung up on** by the hearing party. The Steinberg quote is qualitative evidence that it happens; there is no rate.
4. **Whether InnoCaption's AI Refine can be disabled** — not stated on the announcement page. Check before claiming anyone is forced to use it.
5. **The Census API now requires a key**, so ACS tables (S1810, disability by type) could not be queried directly on 2026-09-22. The NDC figure in §3.1 is the ACS-derived stand-in.
