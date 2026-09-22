"use client";
import { verbatimCount, type Utterance } from "@/lib/ledger";

const LABEL: Record<Utterance["status"], string> = {
  pending: "speaking…",
  match: "spoken verbatim",
  mismatch: "altered",
  interrupted: "interrupted",
};

/**
 * Assistant-mode replies are deliberately NOT verbatim — the user delegated
 * to the assistant, so a strict-equality "mismatch" here would mislabel an
 * intentional paraphrase as an alteration. Only verbatim mode's mismatch
 * means what the word implies; keep the flagged/amber treatment scoped to it.
 */
function labelFor(u: Utterance): string {
  if (u.mode === "assistant" && u.status === "mismatch") return "assistant spoke";
  return LABEL[u.status];
}

function isFlagged(u: Utterance): boolean {
  return u.mode === "verbatim" && u.status === "mismatch";
}

export function Ledger({ utterances }: { utterances: Utterance[] }) {
  const { matched, total } = verbatimCount(utterances);

  return (
    <section aria-label="Verbatim ledger" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-slate-300">
        {matched} of {total} relayed verbatim
      </h2>

      <ol className="flex flex-col gap-2">
        {utterances.map((u) => (
          <li key={u.id} className="rounded-lg border border-slate-700 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-slate-400">you typed</span>
              <span className={isFlagged(u) ? "text-amber-400" : "text-slate-400"}>
                {labelFor(u)}
                {u.mode === "assistant" ? " · assistant" : ""}
              </span>
            </div>
            <p className="text-slate-100">{u.typedText}</p>
            {u.spokenText !== null && u.status !== "match" && (
              <>
                <span className="text-slate-400">actually spoken</span>
                <p className={isFlagged(u) ? "text-amber-200" : "text-slate-300"}>{u.spokenText}</p>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
