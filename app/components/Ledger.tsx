"use client";
import { verbatimCount, type Utterance } from "@/lib/ledger";

const LABEL: Record<Utterance["status"], string> = {
  pending: "speaking…",
  match: "spoken verbatim",
  mismatch: "altered",
  interrupted: "interrupted",
};

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
              <span className={u.status === "mismatch" ? "text-amber-400" : "text-slate-400"}>
                {LABEL[u.status]}
                {u.mode === "assistant" ? " · assistant" : ""}
              </span>
            </div>
            <p className="text-slate-100">{u.typedText}</p>
            {u.spokenText !== null && u.status !== "match" && (
              <>
                <span className="text-slate-400">actually spoken</span>
                <p className="text-amber-200">{u.spokenText}</p>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
