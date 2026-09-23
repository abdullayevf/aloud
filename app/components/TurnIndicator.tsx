"use client";
import type { TurnLabel } from "@/lib/turn-state";

/**
 * The loudest thing on the screen, and the reason is not decorative: a hearing
 * person knows when to speak because they hear silence, and a deaf user has no
 * such cue at all. Interface spec §2.1.
 *
 * Four channels carry the state, so none of them has to carry it alone — the
 * word, the colour, the dot, and the motion. The motion is the one worth
 * explaining: rings travel outward from the dot while the other person is
 * talking (sound arriving), a bar travels left to right under the words while
 * the user's own line goes out (sound leaving), and when the line is the
 * user's to take, nothing moves at all. Stillness is the cue. Keyframes and
 * the reduced-motion fallback live in app/globals.css.
 */
const STATE: Record<
  TurnLabel,
  { text: string; dot: string; tone: string; rings?: true; breathe?: true; sweep?: true }
> = {
  connecting: { text: "Connecting…", dot: "bg-mute", tone: "text-mute", breathe: true },
  listening: { text: "Your turn", dot: "bg-exact", tone: "text-exact" },
  theirs: { text: "They're speaking", dot: "bg-altered", tone: "text-altered", rings: true },
  yours: { text: "Speaking your words", dot: "bg-cut", tone: "text-cut", sweep: true },
};

export function TurnIndicator({ label }: { label: TurnLabel }) {
  const state = STATE[label];
  return (
    <p
      role="status"
      aria-live="polite"
      className={`relative flex items-center gap-3 py-1 text-xl font-bold transition-colors duration-300 sm:text-2xl ${state.tone}`}
    >
      <span aria-hidden="true" className="relative flex h-3 w-3 shrink-0">
        {state.rings && (
          <>
            <span className={`ring absolute inset-0 rounded-full ${state.dot}`} />
            <span className={`ring ring-late absolute inset-0 rounded-full ${state.dot}`} />
          </>
        )}
        <span
          className={`relative h-3 w-3 rounded-full transition-colors duration-300 ${state.dot} ${
            state.breathe ? "breathe" : ""
          }`}
        />
      </span>

      {/* Keyed on the label so React remounts it and the entry animation runs
        * on every change — the transition IS the notification here. */}
      <span key={label} className="rise">
        {state.text}
      </span>

      {state.sweep && (
        <span
          aria-hidden="true"
          className={`sweep absolute bottom-0 left-0 h-0.5 w-1/4 rounded-full ${state.dot}`}
        />
      )}
    </p>
  );
}
