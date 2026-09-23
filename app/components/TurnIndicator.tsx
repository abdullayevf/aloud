"use client";
import type { TurnLabel } from "@/lib/turn-state";

/**
 * The loudest thing on the screen, and the reason is not decorative: a hearing
 * person knows when to speak because they hear silence, and a deaf user has no
 * such cue at all. Interface spec §2.1.
 */
const STATE: Record<TurnLabel, { text: string; dot: string; tone: string }> = {
  connecting: { text: "Connecting…", dot: "bg-mute", tone: "text-mute" },
  listening: { text: "Your turn", dot: "bg-exact", tone: "text-exact" },
  theirs: { text: "They're speaking", dot: "bg-altered animate-pulse", tone: "text-altered" },
  yours: { text: "Speaking your words", dot: "bg-cut animate-pulse", tone: "text-cut" },
};

export function TurnIndicator({ label }: { label: TurnLabel }) {
  const state = STATE[label];
  return (
    <p
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 text-2xl font-bold ${state.tone}`}
    >
      <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${state.dot}`} />
      {state.text}
    </p>
  );
}
