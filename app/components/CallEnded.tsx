"use client";

/**
 * The last frame of the submission video. It previously rendered as 14px green
 * text inside a header.
 *
 * The word stays "deleted": DELETE /v1/sessions/{id} is a documented SOFT
 * delete. Never "erased", never "destroyed". Repo honesty rule.
 */
export function CallEnded({
  deletion,
  matched,
  total,
  onRestart,
}: {
  deletion: string | null;
  matched: number;
  total: number;
  onRestart: () => void;
}) {
  return (
    <section aria-label="Call ended" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
        <p className="text-3xl font-bold text-ink">Call ended</p>
        <p className="text-xl text-exact">
          {matched} of {total} lines spoken exactly as you typed them
        </p>
        <div className="border-t border-line pt-4">
          <p className="measure text-lg text-dim">
            {deletion ?? "Deleting the provider's recording…"}
          </p>
        </div>
      </div>

      <button
        onClick={onRestart}
        className="self-start rounded-lg border border-line px-5 py-3 text-lg text-dim hover:bg-surface-up"
      >
        Make another call
      </button>
    </section>
  );
}
