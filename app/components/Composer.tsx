"use client";
import type { RelayMode } from "@/lib/sentinel";

const QUICK = [
  "I'm using a relay service — please speak normally.",
  "Please repeat that.",
  "Please hold on.",
  "Yes.",
  "No.",
];

export function Composer({
  value,
  onChange,
  onSend,
  mode,
  onModeChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string, mode: RelayMode) => void;
  mode: RelayMode;
  onModeChange: (mode: RelayMode) => void;
  disabled: boolean;
}) {
  // Controlled from the page: when a line is cut off by the hearing party
  // talking over it, the page writes the unspoken remainder back in here so
  // pressing Enter continues the sentence. Interface spec §2.5.
  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, mode);
    onChange("");
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
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(value);
          }
        }}
        aria-label="Type what you want said"
        placeholder="Type here. Enter speaks it."
        className="min-h-28 rounded-lg border border-line bg-surface-up p-4 text-xl leading-relaxed text-ink placeholder:text-mute disabled:opacity-50"
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mode === "assistant"}
          disabled={disabled}
          onChange={(e) => onModeChange(e.target.checked ? "assistant" : "verbatim")}
        />
        <span className={mode === "assistant" ? "font-bold text-altered" : "text-dim"}>
          {mode === "assistant"
            ? "ASSISTANT IS SPEAKING — it handles menus and hold, and never answers for you"
            : "Assistant mode (menus and hold only) — off"}
        </span>
      </label>
    </section>
  );
}
