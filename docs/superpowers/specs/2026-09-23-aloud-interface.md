# Aloud — interface spec

**Written 2026-09-23.** Supplements [`2026-09-22-aloud-design.md`](2026-09-22-aloud-design.md), which stays authoritative for architecture, the pass-through and the five gates. This document covers only what is on the screen, who is looking at it, and why.

It exists because the interface built in Tasks 6–13 was never opened in a browser. It renders `text-slate-100` on a `#ffffff` background with `border-slate-700` borders measured at **1.4:1** against their own surface, under `Arial` hardcoded in `globals.css` overriding the Geist that `layout.tsx` loads, titled `Create Next App`. That is not a taste problem; it is untested output. §4 replaces it.

---

## 0. What was decided, and what it costs to reverse

| # | Decision | Cost to reverse |
|---|---|---|
| 1 | The screen belongs to **one person** — the deaf user. The hearing party has no screen. | Whole layout |
| 2 | The demo is **laptop + a real phone on speakerphone**, acoustically coupled, calling a real person. | The setup card and the video script |
| 3 | **Turn-taking is the hero element**, driven by `input.speech.started` / `input.speech.stopped`. | One component |
| 4 | **One chronological column**, not two panes; the ledger becomes an **inline receipt on each of the user's own lines**. | `Timeline.tsx` and its tests |
| 5 | On interruption the **unspoken remainder returns to the composer**. No button. | `lib/ledger.ts` + one wire in `page.tsx` |
| 6 | Palette is a **deep ink-green**, not blue, not purple. Reasoning in §4.1 is competitive, not aesthetic. | `globals.css` tokens |
| 7 | Typeface is **Atkinson Hyperlegible**. | `layout.tsx` |

---

## 1. Who is holding this

One person. The deaf, hard-of-hearing or non-speaking user. They are alone with it.

The hearing party is **on a phone, somewhere else**. They never see a pixel of this. Any layout that reads as a conversation between two people sitting at one laptop is describing a product we did not build.

The design spec already said this on day one and the build drifted from it:

> **`voice_focus: "far-field"`** — the demo's hearing party is a speakerphone in the room, not a headset.
> — [`2026-09-22-aloud-design.md`](2026-09-22-aloud-design.md) §, line 96

### 1.1 The demo is a real phone call

```
 deaf user            laptop (Aloud)           phone on speaker          far end
 types ─────────────► speaks aloud ──────────► mic picks it up ────────► a real person
 reads captions ◄──── captions it   ◄───────── speaker plays  ◄───────── talks back
```

No Twilio, no SIP, no funded number — the constraint PRD §5 names as the reason telephony is out of scope. The laptop is the relay; the phone is the line. This is honest: it is a real call to a real person, and the relay is doing real work in the middle. It is also why the browser was chosen in the first place — free acoustic echo cancellation (design spec §, "browser audio").

**The risk this creates, which must be checked before filming.** Two echo-cancellation systems now run in series: the laptop's and the phone's. If the laptop's AEC fails — the documented Firefox failure mode, already the top on-camera risk in [`../../TASKS.md`](../../TASKS.md) — the laptop's microphone hears **its own text-to-speech** and captions it. The user's own words then appear on screen as though the hearing party had said them. That is worse than a glitch: it is the product asserting something false about who spoke. Task 9 makes it an explicit pass/fail check, not an impression.

---

## 2. What the screen must do that it currently does not

### 2.1 Turn-taking (the one that matters)

A hearing person knows when to speak because they hear silence. **A deaf user has no such cue.** It is the single largest thing missing, and the data is already arriving and being thrown away: `lib/relay-client.ts` uses `input.speech.started` for exactly one purpose — `this.player.flush()` — and ignores `input.speech.stopped` entirely.

Both events were observed firing in a live session on 2026-09-23 (`scripts/probe-audio.mjs`). Turning them into a visible state costs nothing and no competitor has it, because no competitor's user is the one being spoken *for*.

**The state machine** (implemented as a pure reducer in `lib/turn-state.ts` so it is testable without a socket):

| State | Entered on | Says |
|---|---|---|
| `connecting` | before `session.ready` | Connecting |
| `listening` | `session.ready`, `input.speech.stopped`, `reply.done` | **Your turn** |
| `theirs` | `input.speech.started` | **They're speaking** |
| `yours` | `reply.started` **and a line of ours is still unreceipted** | **Speaking your words** |

`theirs` outranks `yours` if both are live: if the hearing party starts talking while our audio is still going out, the truthful thing to show is that they are talking, and the barge-in flush is about to fire anyway.

#### Correction, 2026-09-23: `reply.started` is not "your words are going out"

As first built, `yours` was entered on `reply.started` alone. That was wrong every single turn, and visibly so: after the hearing party stopped talking the indicator flipped to **Speaking your words** for around two and a half seconds while nothing whatsoever was being said in the user's name.

The cause is in the documented message sequence, not in our code: the API takes a reply turn after **every** hearing-party turn — `input.speech.stopped` → `transcript.user` → `reply.started` ([`../../assemblyai-integration.md`](../../assemblyai-integration.md), Lifecycle and events) — whether or not the client asked for one. Gate **G2** already measured what is inside those turns: `reply.audio` frames streaming for ~2.4 s and **zero** `transcript.agent` events. Silence with a reply wrapped around it.

So `reply.started` means *the agent is taking a turn*. It does not mean the turn contains the user's words, and the socket carries nothing that distinguishes the two at the moment the reply starts.

**The second fact comes from the ledger.** A typed line sits `pending` from the moment it is sent until the provider's own `transcript.agent` comes back saying what was spoken; `awaitingReceipt()` in [`lib/ledger.ts`](../../../lib/ledger.ts) is exactly that question, and `turnLabel(state, awaitingReceipt)` will not say `yours` without it. A reply turn with nothing outstanding is the agent's silence, which is what `listening` already says correctly.

This also fails safe, which a counter of outstanding replies would not: if a reply is never acknowledged at all, `reply.done` still clears `replying` and the label falls back to **Your turn** rather than sticking on a claim that is not true.

**Why this mattered more than a cosmetic glitch.** The turn indicator is the one element on this screen a deaf user cannot check by ear. It was asserting that their words had gone out, on a call where whether their words went out is the entire question.

### 2.2 Your own voice is invisible

The user cannot hear their own line being read aloud. Currently the only feedback is the word `speaking…` in 14px grey inside the ledger. While `yours` is live, the line going out is shown as the active thing on screen, at caption size.

### 2.3 Two columns force an impossible choice

`app/page.tsx:219` splits captions (left) and composer (right) into `md:grid-cols-2`. While the user types, the captions are outside their reading focus. For someone whose only channel is vision, that is the entire problem restated as a layout.

**One vertical column.** Their words and the user's words interleaved in time order, composer pinned beneath. A call is one timeline; render one timeline.

### 2.4 The ledger is a second thing to look at

PRD §4.1 requires typed-versus-spoken per utterance with a running count. It does not require a separate list, and a separate list costs a second reading zone.

**The receipt goes on the line it belongs to.**

- `match` → the line, plus `✓ spoken exactly`. One line. The overwhelming majority of rows.
- `mismatch` (verbatim mode) → **expands** to show `you typed` and `actually spoken` as two blocks. This is the loud state and it should be loud — it is also the moment PRD Day 8 wants forced on camera.
- `interrupted` → the spoken fragment, plus what did not get out, greyed.
- assistant mode → labelled `assistant spoke`, never flagged amber (an intentional paraphrase is not an alteration; the rule already exists in `app/components/Ledger.tsx:11-24` and must survive the rewrite).

The running count — `12 of 12 spoken exactly` — moves to the header, where it is visible without scrolling.

### 2.5 An interrupted line dead-ends

Measured 2026-09-23: typed `"Please repeat that."`, interrupted at 0.62 s, `transcript.agent` returned `interrupted=true, text="Please"`. The ledger records that correctly. But `repeat that.` was never spoken and there is no way to finish it short of retyping.

**The remainder returns to the composer**, cursor at the end. The natural act — press Enter — continues the sentence. No new control to learn.

The ledger is not rewritten: fragment one stays logged as `interrupted`, and the continuation is a new row. Nothing is retroactively edited, which is the whole basis of the receipt's credibility.

`remainderOf(typed, spoken)` is a prefix match on the normalised forms (`lib/ledger.ts` already exports `normalizeForCompare`). If the spoken fragment is not a prefix of what was typed — TTS dropped a word, or the transcript came back reordered — **return the whole typed line**, not a guess. Better to offer the user their entire sentence again than a silently wrong fragment of it.

The handoff itself does not live in `app/page.tsx`: `ledgerReducer` (`lib/ledger.ts`) computes the remainder inside the reducer, on the same event that marks the row `interrupted`, and stores it as `Utterance.remainder`. `page.tsx` and `Composer.tsx` only read that field — they do not compute it. An earlier version of this mechanism lived in a second updater in `page.tsx` and, because that updater never actually ran, silently dropped every remainder on the floor; moving the computation into the reducer closed that gap.

### 2.6 Typing fast produces typos, and the line is read out as typed

**Added 2026-09-23.** Someone typing at conversational speed into a live call makes transposition errors — `teh`, `adn`, `woudl` — and the relay reads them out exactly as typed, because reading them out exactly as typed is the product. The result is a line that goes out sounding wrong through no fault of the pass-through.

**The correction happens in the composer, never on the relay path.** [`lib/autocorrect.ts`](../../../lib/autocorrect.ts) runs in the browser, on the text in the box, before Enter. `/api/llm/v1/chat/completions` is untouched: it still echoes what arrives, byte for byte, with no model in the path. What the user reads in the box is what goes out, so the receipt keeps meaning exactly what it says.

This is the line that matters. A correction the user cannot see before it is spoken is the same class of failure as a model quietly tidying their words — the thing this entire repo is built to make impossible. So every correction is shown in the box, announced in a live region, and reversible with one key (Backspace, or the Undo control). The one case where it is visible only after the fact is the final word on Enter, which never met a space; that correction is still named on screen, and the corrected line is what the ledger and the timeline show.

**Why a table and not a spell checker.** "Only where we're really confident" is a precision requirement, and the way to meet it is to make a false positive structurally impossible rather than unlikely. Edit-distance matching against a dictionary cannot: it turns a real word the dictionary happens to lack into a different real word, silently, mid-call — `causal` becomes `casual` and the user finds out from the other person's reply. Instead there is a table of known misspellings, each with exactly one sensible target, every key a string that is not an English word. Nothing is generated and nothing is guessed. Lookup is a single `Map` hit, so there is no latency to discuss and nothing to load.

Words with two ordinary readings are deliberately absent and listed in the module: `its`, `lets`, `were`, `well`, `ill`, `id`, `wed`, `form`, `hwo`. When in doubt, a word goes on that list rather than in the table.

---

## 3. Audio: why the first word breaks

Measured 2026-09-23, `scripts/probe-audio.mjs` against production, three runs:

- the server streams **10 ms frames at ~1× real time** — 696 frames delivering 6.96 s of audio over 6.95 s of wall clock
- **smallest buffer margin observed: 0 ms.** Best case across runs: 10 ms.

`ReplyPlayer.enqueue` (`lib/audio/playback.ts:23-24`) schedules the first frame at `Math.max(cursor, ctx.currentTime)` — that is, **at `currentTime` exactly**, with no lead-in. Browsers have already rendered past `currentTime` by their output latency, typically 20–50 ms and higher on Firefox and over Bluetooth. So the first several frames are each scheduled into an already-rendered past; the Web Audio spec starts such a source immediately instead, at the next render quantum. Three to five 10 ms frames therefore start in **the same quantum, stacked on top of each other**, summed into one burst.

That is the reported "blurp". It affects the first word specifically because after a few frames the cursor climbs past the real-time clock and scheduling becomes sane — which is exactly the symptom described.

**Fix: a lead-in.** Schedule against `currentTime + LEAD`:

```
LEAD = max(0.12 s, 2 × ctx.outputLatency)
```

`outputLatency` is absent in Safari, so the floor carries it. Because the scheduler already takes `Math.max(cursor, …)`, the lead applies at the start of a sentence and after a drain or a flush, and costs nothing mid-sentence.

**The trade-off, stated honestly:** this adds up to 120 ms before the first word is heard. G3 measured the custom-LLM hop at **28–29 ms**; the total time-to-first-audio figure published in the README must include the lead-in rather than quoting the hop alone. 120 ms sits below the ~200 ms gap of ordinary human turn-taking, and an unintelligible first word is a worse defect than a tenth of a second.

---

## 4. Visual design

### 4.1 Colour, and why not blue

Pulled from the live CSS of the products in this market on 2026-09-23:

| Product | Brand colour | Source |
|---|---|---|
| **InnoCaption** | `#0b3797` navy (46 occurrences on the landing page), `#051e55` | `innocaption.com` |
| **Rylo** (ex-Nagish) | royal blue `oklch(54.93% .2488 263.97)` on warm cream `#faf5f2` | `rylo.com/_astro/base-layout.*.css` |
| **AssemblyAI** (the judges) | purple `#887bdd`, warm sand `#e3dfcd` | `assemblyai.com` |

Both incumbents own blue. The sponsor owns purple. **Choosing either is a positioning mistake before it is an aesthetic one** — a blue captioned-calling product looks like a clone of the two companies PRD §7 is at pains to distinguish Aloud from.

**[DeafSpace](https://infoguides.rit.edu/deafspace/principles)** — Gallaudet University's design guidelines, the only substantial body of work on designing *for* deaf people — names Light and Color as one of five principles, and recommends soft green and blue tones as background colours, on the grounds that a visual-first language causes more eyestrain.

**Stated honestly:** that rationale is about contrast against *skin tone* so that signing reads clearly. Aloud has no video, so the reasoning does not transfer directly, and this spec does not claim it does. What transfers is the finding underneath it: users who take everything through their eyes accumulate strain, so the surface should be soft and diffuse — **no glare-white, no pure-black-with-neon halation, low visual noise.**

**The captions are subtitles**, and the captioning literature converges on white-on-dark, sans-serif, ≤2 lines, ≤45 characters per line, and — load-bearing — **never colour alone to carry meaning**, because colourblind users lose it ([Smashing](https://www.smashingmagazine.com/2023/01/closed-captions-subtitles-ux/), [Southeast ADA](https://adasoutheast.org/best-practices-for-closed-captioning/)).

### 4.2 Tokens, with measured contrast

**Light, and the hardest-contrast light there is: white, black, and three dark accents.** Chosen 2026-09-23 from four light candidates rendered side by side, after four dark ones were rejected. It is the safest surface for the thing this has to survive — a projector in a judging room — and it is the one palette where the captions cannot be anything but legible.

Computed with the WCAG 2.x relative-luminance formula:

| Token | Value | Role | Measured |
|---|---|---|---|
| `--paper` | `#FFFFFF` | page | — |
| `--surface` | `#F4F4F5` | a line, a card | — |
| `--surface-up` | `#EAEAEC` | the composer, active states | 1.09:1 vs surface (elevation only) |
| `--line` | `#4F4F4F` | **every border** | **8.19:1 vs paper** · 7.45:1 vs surface |
| `--ink` | `#000000` | captions, typed text | **21.00:1** |
| `--dim` | `#454545` | secondary | 9.59:1 AAA |
| `--mute` | `#5E5E5E` | labels | 6.48:1 AA · 5.90:1 on surface |
| `--exact` | `#006D3B` | spoken exactly · your turn | 6.46:1 AA |
| `--altered` | `#8F4300` | **altered** | 7.07:1 AAA |
| `--cut` | `#33566B` | interrupted, incomplete | 7.82:1 AAA |
| `--danger` | `#A81E12` | error, hang up | 7.34:1 AAA |

On a light surface the accents must go **dark** to stay readable, so "altered" is a burnt orange rather than a bright amber and "exact" is a deep green. That is the palette working, not a compromise.

`--line` at 8.19:1 clears WCAG 2.1 SC 1.4.11 (Non-text Contrast, 3:1 for component boundaries) with room to spare. The borders being replaced measure **1.4:1**.

**Known limitation, not hidden:** the three receipt accents separate by only **1.09–1.21:1 in greyscale** — they are deliberately matched in darkness so none shouts over the others on the page, which means hue cannot carry status alone. The captioning guidance requires that anyway. Every status carries **four redundant channels**: an icon, a word, a form (altered is a *filled* chip; interrupted is outline text), and colour last.

**Rejected, and why it is worth recording:** a deep ink-green dark theme, and three other dark candidates. Rejected on the user's judgement after seeing them rendered. The competitive reasoning in §4.1 still holds and still rules out blue and purple — white and black are nobody's brand.

### 4.3 Type

`Atkinson Hyperlegible` — Braille Institute, letterforms drawn so that characters cannot be confused with one another. Verified available on Google Fonts 2026-09-23 (HTTP 200, weights 400 and 700).

Not decoration: **Usher syndrome** — congenital deafness with progressive vision loss — is a significant population within relay's users, and captions are the accessibility surface of this product.

- captions and the user's own lines: **20px / 1.5**, measure capped at **45ch** per §4.1
- labels and receipts: 14px, sentence case, no added tracking, `--text-mute` or `--text-dim`
- numbers in the running count: `tabular-nums`, so the count does not jitter as it climbs
- one weight jump only — 400 and 700. No 500/600 mush.

**Revised 2026-09-23.** Labels were originally specified as *"13px, letter-spaced"* and built as `uppercase tracking-widest`. That is wrong here twice over. It is the tracked-out all-caps eyebrow that appears on every generated page regardless of subject, so it reads as template chrome — and, more to the point, Atkinson Hyperlegible is drawn so that letterforms cannot be confused with one another, which all-caps with wide tracking destroys: it strips word shape and forces letter-by-letter reading on exactly the labels a user is glancing at mid-call. Sentence case at 14px is the fix, and it is an accessibility fix before it is a taste one.

`app/globals.css:25` hardcodes `font-family: Arial, Helvetica` on `body`, overriding the font `layout.tsx` loads. It is deleted, not overridden.

### 4.4 Register

Not a command center; this is not a dashboard. Not neon; glare is the thing being designed against. Calm, editorial, large type, **exactly one loud thing on screen at a time** — because it is read under stress while someone is talking.

---

## 5. Screen states

| State | Screen |
|---|---|
| **before** | The wordmark, what Aloud is in one sentence, and the setup card: *dial on your phone · put it on speaker · set it beside the laptop*. Voice choice (immutable per session — design spec). One button: **Start the call**. |
| **live** | Turn indicator (§2.1) · timeline (§2.3) · composer with quick phrases and the correction notice (§2.6) · running verbatim count beside the indicator. |
| **ended** | The deletion receipt, full width: `DELETE /v1/sessions/{id}` returned 204, the session id, the time. Plus the final count. This is the last frame of the submission video and it currently renders as 14px green text in a header. |

The word on screen stays **"deleted"** — a documented soft delete — never "erased" or "destroyed". Repo honesty rule, and design spec §, line 264.

### 5.1 The live screen is a console, not a page — 2026-09-23

As first built, the live screen was one scrolling document. Ten minutes into a call the turn indicator was somewhere above the top of the window, which is the same as not having built it: the element a deaf user depends on most had scrolled away from them.

**The live screen is now viewport-height with exactly one scrolling region.**

```
┌─ Aloud ──────────────────────────────────── connected ─┐  fixed
├─ ◉ They're speaking          12 of 12 spoken exactly ──┤  fixed
│                                                        │
│  timeline — the only thing that scrolls                │  scrolls
│                                                        │
├─ composer · quick phrases · correction notice ─────────┤  fixed
└─ Hang up and delete the recording ─────────────────────┘  fixed
```

The count moves here rather than into the page header (§2.4 asked for "the header"), because this band is the one strip guaranteed to be on screen for the whole call.

The timeline follows its own tail, and stops following the moment the user scrolls back to re-read something — resuming only when they return to the end. A screen that yanks itself back to the bottom while someone is reading is worse than one that never followed.

**The regression guard** is in `Timeline.test.tsx`: the timeline must own its own overflow. If it ever stops, the page scrolls instead and this bug returns exactly as it was.

### 5.2 It was rendered and looked at — 2026-09-23

This document opens by saying the interface was never opened in a browser. It has now been, so that sentence stops being true of the current build.

Method: the real components server-rendered with the real compiled Tailwind output, screenshotted in headless Chrome at 1280×860 and 390×844 — every live state, the receipt states, before and after. (Playwright's browser CDN is unreachable from this host; Chrome from `dl.google.com` installs fine. Worth knowing before losing an hour to it again.)

Four things were wrong on screen that no test had caught, and all four are fixed:

1. **The `theirs` rings rendered as a smudge.** Filled discs scaling up over a 12px dot read as a blur, not as arrival. They are outlines now, and the dot is 10px inside a 16px box so the ring has daylight to leave from.
2. **The `yours` sweep sat directly on the rule beneath it**, reading as two stacked lines. The indicator carries bottom padding now.
3. **The composer could be dragged taller**, pushing the timeline out of a fixed-height console. `resize-none`.
4. **A line still in flight was coloured `--exact`** — the green that means the provider's record came back matching. `speaking…` was claiming a receipt it did not have. Pending is `--mute` now; see `RECEIPT_TONE` in `Timeline.tsx`.

Item 4 is the one worth dwelling on: it was an honesty defect sitting in the colour system, in the component whose entire job is to be honest about what was said, and it survived a full test suite because no test asserts a colour. Render the screen.

---

## 6. Out of scope for this spec

- A screen for the hearing party. They are on a phone. (PRD §5.)
- Caption customisation (font size, colour) — the FCC requires it of certified providers; Aloud is not one and does not claim to be. Worth one line in the roadmap, not a build.
- Any post-call artifact. Spec §0.1 of the design doc; the deleted product had one.
