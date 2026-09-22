"use client";

export function CaptionPane({ finals, partial }: { finals: string[]; partial: string }) {
  return (
    <section aria-label="Live captions" aria-live="polite" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold tracking-wide text-slate-300">They said</h2>
      {finals.map((line, i) => (
        <p key={i} className="text-lg text-slate-100">
          {line}
        </p>
      ))}
      {partial && <p className="text-lg text-slate-400">{partial}</p>}
    </section>
  );
}
