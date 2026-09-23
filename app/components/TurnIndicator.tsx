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
  { text: string; dot: string; tone: string; ring?: string; breathe?: true; sweep?: true }
> = {
  connecting: { text: "Connecting…", dot: "bg-mute", tone: "text-mute", breathe: true },
  listening: { text: "Your turn", dot: "bg-exact", tone: "text-exact" },
  theirs: {
    text: "They're speaking",
    dot: "bg-altered",
    tone: "text-altered",
    // An outline, not a filled disc: a solid circle scaling up over the dot
    // renders as a smudge, where a ring travelling outwards reads as arrival.
    ring: "border-2 border-altered",
  },
  yours: { text: "Speaking your words", dot: "bg-cut", tone: "text-cut", sweep: true },
};

export function TurnIndicator({ label }: { label: TurnLabel }) {
  const state = STATE[label];
  return (
    <p
      role="status"
      aria-live="polite"
      className={`relative flex items-center gap-3 pt-1 pb-2.5 text-xl font-bold transition-colors duration-300 sm:text-2xl ${state.tone}`}
    >
      {/* The ring travels from the edge of this box, not from the edge of the
        * dot: at 12px a ring starts already touching the dot and the pair reads
        * as one smudge. The box is 16px and the dot inside it is 10px, so there
        * is visible daylight for the ring to leave from. */}
      <span aria-hidden="true" className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        {state.ring && (
          <>
            <span className={`ring absolute inset-0 rounded-full ${state.ring}`} />
            <span className={`ring ring-late absolute inset-0 rounded-full ${state.ring}`} />
          </>
        )}
        <span
          className={`relative h-2.5 w-2.5 rounded-full transition-colors duration-300 ${state.dot} ${
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
