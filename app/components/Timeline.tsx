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

/** There is one mode, so a mismatch has one meaning: the line that went out was
 * not the line that was typed. That is the loud state and it should be loud. */
const isAltered = (u: Utterance) => u.status === "mismatch";

function Icon({ status, colour }: { status: Utterance["status"]; colour: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: colour,
    strokeWidth: 3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
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

function Said({ u }: { u: Utterance }) {
  const word = RECEIPT[u.status];
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <p className="measure text-xl leading-relaxed text-ink">{u.typedText}</p>

      {isAltered(u) ? (
        <p className="mt-3 inline-flex items-center gap-2 rounded bg-altered px-2 py-1 text-[13px] font-bold text-paper">
          <Icon status={u.status} colour="#ffffff" />
          {word}
        </p>
      ) : (
        <p
          className={`mt-3 inline-flex items-center gap-2 text-[13px] ${
            u.status === "interrupted" ? "text-cut" : "text-exact"
          }`}
        >
          <Icon status={u.status} colour={u.status === "interrupted" ? "#33566b" : "#006d3b"} />
          {word}
        </p>
      )}

      {isAltered(u) && u.spokenText !== null && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-sm text-mute">What the line actually said:</p>
          <p className="measure mt-1 text-xl leading-relaxed text-ink">{u.spokenText}</p>
        </div>
      )}
    </li>
  );
}

export function Timeline({
  heard,
  utterances,
  partial,
}: {
  heard: HeardLine[];
  utterances: Utterance[];
  partial: string;
}) {
  const items = [
    ...heard.map((h) => ({ seq: h.seq, node: <Heard key={`h${h.id}`} text={h.text} /> })),
    ...utterances.map((u) => ({ seq: u.seq, node: <Said key={`u${u.id}`} u={u} /> })),
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
      <ol className="flex flex-col gap-5">{items.map((i) => i.node)}</ol>

      {/* The line still being said. aria-live so a screen reader announces it
        * as it arrives — a deaf user may also be a screen-reader user. */}
      <p aria-live="polite" className="measure text-xl leading-relaxed text-mute">
        {partial}
      </p>
    </section>
  );
}
