"use client";
import { useEffect, useRef, useState } from "react";
import { correctAtBoundary, correctFinalWord, type Correction } from "@/lib/autocorrect";

const QUICK = [
  "I'm using a relay service — please speak normally.",
  "Please repeat that.",
  "Please hold on.",
  "Yes.",
  "No.",
];

/** What the last correction changed, and how to put it back if there is still
 * anything to put back. Once the line has been spoken there is nothing to undo
 * and the notice says so by having no button, rather than offering one that
 * cannot work. */
interface Notice extends Correction {
  revert: { before: string; after: string } | null;
}

export function Composer({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  // Where the caret must land after a correction changed the text under it.
  // A replacement can be longer or shorter than what it replaced ("alot" is two
  // words), and a controlled textarea would otherwise drop the caret at the end.
  const caret = useRef<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (caret.current === null) return;
    box.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  // Controlled from the page: when a line is cut off by the hearing party
  // talking over it, the page writes the unspoken remainder back in here so
  // pressing Enter continues the sentence. Interface spec §2.5.
  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // The last word never met a space, so it never met the correction pass.
    // Without this the composer fixes every word but the one just finished.
    const { text: corrected, correction } = correctFinalWord(trimmed);
    onSend(corrected);
    onChange("");
    setNotice(correction ? { ...correction, revert: null } : null);
  }

  function type(next: string, at: number) {
    const fixed = correctAtBoundary(next, at);
    if (!fixed) {
      onChange(next);
      return;
    }
    onChange(fixed.text);
    caret.current = fixed.caret;
    setNotice({ ...fixed.correction, revert: { before: next, after: fixed.text } });
  }

  function undo() {
    if (!notice?.revert) return;
    onChange(notice.revert.before);
    setNotice(null);
    box.current?.focus();
  }

  return (
    <section aria-label="Compose" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {QUICK.map((phrase) => (
          <button
            key={phrase}
            type="button"
            disabled={disabled}
            onClick={() => send(phrase)}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-dim hover:bg-surface-up disabled:opacity-50"
          >
            {phrase}
          </button>
        ))}
      </div>

      <textarea
        ref={box}
        value={value}
        disabled={disabled}
        onChange={(e) => type(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          // Backspace immediately after a correction puts the typo back, the way
          // a phone keyboard does. Only while the text is still exactly what the
          // correction produced — after that the user has moved on.
          if (e.key === "Backspace" && notice?.revert?.after === value) {
            e.preventDefault();
            undo();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(value);
          }
        }}
        aria-label="Type what you want said"
        aria-describedby="correction-notice"
        placeholder="Type here. Enter speaks it."
        /* resize-none: the live screen is a fixed-height console, and dragging
         * the textarea taller would push the timeline out of it. */
        className="min-h-28 resize-none rounded-lg border border-line bg-surface-up p-4 text-xl leading-relaxed text-ink placeholder:text-mute disabled:opacity-50"
      />

      {/* Every correction is visible before the line goes out, and reversible
        * with one key. A fix the user cannot see is the same failure as a model
        * quietly rewording them. */}
      <p
        id="correction-notice"
        aria-live="polite"
        className="flex min-h-6 flex-wrap items-baseline gap-x-2 text-sm text-dim"
      >
        {notice && (
          <>
            <span>
              Changed <span className="line-through">{notice.from}</span> to{" "}
              <span className="font-bold text-ink">{notice.to}</span>
            </span>
            {notice.revert && (
              <button
                type="button"
                onClick={undo}
                className="rounded border border-line px-2 py-0.5 text-sm text-dim hover:bg-surface-up"
              >
                Undo
              </button>
            )}
          </>
        )}
      </p>
    </section>
  );
}
