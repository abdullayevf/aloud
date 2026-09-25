"use client";
import { useEffect, useRef } from "react";
import type { Utterance } from "@/lib/ledger";

export interface HeardLine {
  id: string;
  seq: number;
  text: string;
}

/** Four redundant channels per status — icon, word, form, colour last —
 * because the captioning literature is clear that colour alone loses
 * colourblind users, and because the three accents are deliberately matched in
 * darkness so none shouts over the others (interface spec §4.2). */
const RECEIPT: Record<Utterance["status"], string> = {
  pending: "speaking…",
  match: "spoken exactly",
  mismatch: "altered",
  interrupted: "interrupted",
};

/** Colour last, and never ahead of the evidence: a line still in flight is
 * `mute`, not the green that means the provider's own record came back matching.
 * Showing "speaking…" in the verified colour would claim the receipt before it
 * exists. `mismatch` is absent — it takes the filled chip instead. */
const RECEIPT_TONE: Record<Utterance["status"], { text: string; hex: string }> = {
  pending: { text: "text-mute", hex: "#5e5e5e" },
  match: { text: "text-exact", hex: "#006d3b" },
  mismatch: { text: "text-altered", hex: "#8f4300" },
  interrupted: { text: "text-cut", hex: "#33566b" },
};

/** There is one mode, so a mismatch has one meaning: the line that went out was
 * not the line that was typed. That is the loud state and it should be loud. */
const isAltered = (u: Utterance) => u.status === "mismatch";

function Icon({
  status,
  colour,
  label,
  className,
}: {
  status: Utterance["status"];
  colour: string;
  /** When given, the icon carries the receipt word itself, as its accessible
   * name — `role="img" aria-label` — instead of being decorative. That is how
   * the quiet `match` mark keeps the word reachable by assistive technology
   * without it ever existing as a text node a sighted user has to read past:
   * an aria-label is announced by a screen reader but invisible to
   * `getByText`, which walks text nodes, not attributes. Every other status
   * still prints the word on screen, so the icon there stays `aria-hidden`
   * and lets that visible text carry the name. */
  label?: string;
  className?: string;
}) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: colour,
    strokeWidth: 3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    ...(label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const }),
  };
  if (status === "match") return <svg {...common}><path d="M20 6 9 17l-5-5" /></svg>;
  if (status === "mismatch") return <svg {...common}><path d="M12 8v5" /><path d="M12 17h.01" /></svg>;
  if (status === "interrupted") return <svg {...common}><path d="M9 5v14" /><path d="M15 5v14" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3" /></svg>;
}

function Heard({ text }: { text: string }) {
  // No label. Their line is plain text; the user's line is a bordered card.
  // That is enough to tell them apart without a word of chrome on screen.
  return (
    <li className="measure text-xl leading-relaxed text-dim">{text}</li>
  );
}

/**
 * The words already spoken, inline with the words the voice has not reached
 * yet, for a `pending` row mid-reply — the live split of `ink` against the
 * playback clock (lib/caption-timeline.ts). `interrupted` shows the same
 * "solid, then ghosted" idea but under its own "Cut off — not spoken:"
 * caption rather than in one running line, because there the two parts are
 * not "so far" and "not yet" — the second part is never coming.
 */
function InkedLine({ spoken, unspoken }: { spoken: string; unspoken: string }) {
  return (
    <p className="measure text-xl leading-relaxed">
      <span className="text-ink">{spoken}</span>
      <span className="text-mute" data-ink="unspoken">{unspoken}</span>
    </p>
  );
}

/** Does the provider's record of this line contain any word at all?
 *
 * `remainderOf` compares word keys, so a spoken text of "" — or of nothing but
 * punctuation — yields no words to match and the remainder comes back as the
 * whole typed line. That case is NOT the fallback below: nothing was spoken, so
 * "Cut off — not spoken:" over the whole line is simply true. This is the test
 * that tells the two apart, and it uses the same notion of "a word" that
 * lib/ledger.ts's `wordKey` does. */
const anythingSpoken = (u: Utterance) => /[\p{L}\p{N}]/u.test(u.spokenText ?? "");

/**
 * What an interruption left behind.
 *
 * `remainderOf` returns the WHOLE typed line when the spoken text is not a
 * clean prefix of it — a deliberate choice, and the right one for the composer,
 * where re-offering everything beats re-offering a wrong fragment. It is the
 * wrong thing to caption. TTS legitimately alters a word mid-line ("an" -> "a"),
 * the prefix match then fails, and the old code printed "Cut off — not spoken:"
 * above words the provider's own record says WERE spoken. That is the screen
 * making a false statement about the user's own words, which is the worst class
 * of bug this product has — so the label is only used when the remainder is a
 * genuine tail, and the fallback says plainly that the two do not line up
 * rather than claiming anything about which words got out.
 */
function CutOff({ u }: { u: Utterance }) {
  if (u.remainder === null) return null;

  // A genuine tail: the spoken text was a prefix, and this is what came after.
  if (u.remainder !== u.typedText || !anythingSpoken(u)) {
    return (
      <div className="mt-2">
        <p className="text-sm text-mute">Cut off — not spoken:</p>
        <p className="measure mt-1 text-xl leading-relaxed text-mute" data-ink="unspoken">
          {u.remainder}
        </p>
      </div>
    );
  }

  // The fallback: words were spoken, but not as a prefix of what was typed, so
  // which of them got out cannot be shown. Say that, and show the typed line
  // as the typed line — not as a list of words nobody heard.
  return (
    <div className="mt-2">
      <p className="text-sm text-mute">
        Cut off. What was spoken does not line up with what you typed, so which words got out
        cannot be shown. What you typed:
      </p>
      <p className="measure mt-1 text-xl leading-relaxed text-dim" data-ink="unaligned">
        {u.typedText}
      </p>
    </div>
  );
}

function Said({ u, ink }: { u: Utterance; ink: { spoken: string; unspoken: string } | null }) {
  const word = RECEIPT[u.status];

  // The most common outcome earns the least ink. A matched line was a
  // bordered card carrying a labelled chip — on a good call, a wall of
  // identical green boxes, the busiest thing on screen for saying the least.
  // What is left is a rule and a mark: the text, a quiet green edge, and an
  // icon that still carries "spoken exactly" as its accessible name. Nothing
  // here is a text node, by design — see Icon's `label` doc above — so a
  // sighted user never re-reads the same two words down the whole call, and
  // a screen reader user still hears them on every single line.
  if (u.status === "match") {
    return (
      <li data-receipt="match" className="border-l-2 border-exact pl-4">
        <p className="measure text-xl leading-relaxed text-ink">{u.typedText}</p>
        <Icon status={u.status} colour={RECEIPT_TONE.match.hex} label={word} className="mt-2" />
      </li>
    );
  }

  // The one state that must be read gets to keep the loud treatment: the
  // bordered card, the filled chip, both texts shown so the disagreement is
  // impossible to scroll past unnoticed.
  if (isAltered(u)) {
    return (
      <li data-receipt="mismatch" className="rounded-lg border border-line bg-surface p-4">
        <p className="measure text-xl leading-relaxed text-ink">{u.typedText}</p>
        <p className="mt-3 inline-flex items-center gap-2 rounded bg-altered px-2 py-1 text-[13px] font-bold text-paper">
          <Icon status={u.status} colour="#ffffff" />
          {word}
        </p>
        {u.spokenText !== null && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-sm text-mute">What the line actually said:</p>
            <p className="measure mt-1 text-xl leading-relaxed text-ink">{u.spokenText}</p>
          </div>
        )}
      </li>
    );
  }

  // An interruption used to be a label: the typed line, and the word
  // "interrupted" underneath it. The user could not see what never left
  // their side. Now the part that made it out stays solid, and the tail —
  // `remainder`, computed once by the reducer and never retroactively edited
  // — renders ghosted under its own caption, so the cut is the thing shown,
  // not just the thing named. CutOff above carries the one case where that
  // caption would be a lie.
  if (u.status === "interrupted") {
    return (
      <li data-receipt="interrupted" className="border-l-2 border-cut pl-4">
        {u.spokenText && <p className="measure text-xl leading-relaxed text-ink">{u.spokenText}</p>}
        <CutOff u={u} />
        <p className={`mt-2 inline-flex items-center gap-2 text-sm ${RECEIPT_TONE.interrupted.text}`}>
          <Icon status={u.status} colour={RECEIPT_TONE.interrupted.hex} />
          {word}
        </p>
      </li>
    );
  }

  // `pending`: the line still being said. `ink` is the live split of that
  // same reply against the playback clock (lib/caption-timeline.ts), so the
  // words ink in as the voice actually reaches them rather than the whole
  // sentence lighting up the instant the reply starts. Before the timeline
  // arrives (`ink` still null for this row) it falls back to the plain typed
  // text — better than nothing rendering for the ~365ms before the first
  // burst (lib/caption-timeline.ts's doc comment has the measured number).
  return (
    <li data-receipt="pending" className="rounded-lg border border-line bg-surface p-4">
      {ink ? (
        <InkedLine spoken={ink.spoken} unspoken={ink.unspoken} />
      ) : (
        <p className="measure text-xl leading-relaxed text-ink">{u.typedText}</p>
      )}
      <p className={`mt-3 inline-flex items-center gap-2 text-sm ${RECEIPT_TONE.pending.text}`}>
        <Icon status={u.status} colour={RECEIPT_TONE.pending.hex} />
        {word}
      </p>
    </li>
  );
}

export function Timeline({
  heard,
  utterances,
  partial,
  ink,
}: {
  heard: HeardLine[];
  utterances: Utterance[];
  partial: string;
  /** The row currently being spoken, split at the playback clock. Required,
   * with no default: a caller that forgets it should not silently get a
   * timeline that never inks in, it should fail to compile. Task 7 wires the
   * real value from lib/caption-timeline.ts's `inkSplit`; until then every
   * call site — including the one in app/page.tsx — passes `null` on
   * purpose, which renders exactly like a row with no live reply. */
  ink: { id: string; spoken: string; unspoken: string } | null;
}) {
  const items = [
    ...heard.map((h) => ({ seq: h.seq, node: <Heard key={`h${h.id}`} text={h.text} /> })),
    ...utterances.map((u) => ({
      seq: u.seq,
      node: (
        <Said
          key={`u${u.id}`}
          u={u}
          ink={ink && ink.id === u.id ? { spoken: ink.spoken, unspoken: ink.unspoken } : null}
        />
      ),
    })),
  ].sort((a, b) => a.seq - b.seq);

  const scroller = useRef<HTMLElement>(null);
  const stuckToBottom = useRef(true);

  // The newest line has to be the visible one — on a live call the user is
  // reading the bottom of this list while someone is still talking. But scroll
  // it back yourself to re-read something and it must stay where you put it,
  // so following resumes only once you return to the end.
  useEffect(() => {
    const el = scroller.current;
    if (el && stuckToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length, partial]);

  return (
    <section
      ref={scroller}
      aria-label="Call"
      onScroll={(e) => {
        const el = e.currentTarget;
        stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-2"
    >
      {/* `measure` here, not just on the text inside each row: without it a
        * card was a 768px box (app/page.tsx's `main` is max-w-3xl) holding
        * 480px of words, with the scrollbar sitting ~290px past where the
        * text actually ends. Capping the list itself means the card edges —
        * and the scrollbar on the `section` above — line up with the reading
        * measure instead of floating at the container's edge. */}
      <ol className="measure flex flex-col gap-5">{items.map((i) => i.node)}</ol>

      {/* The line still being said. aria-live so a screen reader announces it
        * as it arrives — a deaf user may also be a screen-reader user. */}
      <p aria-live="polite" className="measure text-xl leading-relaxed text-mute">
        {partial}
      </p>
    </section>
  );
}
