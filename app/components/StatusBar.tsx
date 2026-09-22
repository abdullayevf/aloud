"use client";

export function StatusBar({
  status,
  deletion,
  error,
}: {
  status: string;
  deletion: string | null;
  error: string | null;
}) {
  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-slate-700 pb-3">
      <span className="text-xl font-semibold text-slate-50">Aloud</span>
      <span className="text-sm text-slate-400">{status}</span>
      {deletion && <span className="text-sm text-emerald-400">{deletion}</span>}
      {error && <span className="text-sm text-rose-400">{error}</span>}
    </header>
  );
}
