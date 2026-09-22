"use client";
import { useState } from "react";
import type { RelayMode } from "@/lib/sentinel";

const QUICK = [
  "I'm using a relay service — please speak normally.",
  "Please repeat that.",
  "Please hold on.",
  "Yes.",
  "No.",
];

export function Composer({
  onSend,
  mode,
  onModeChange,
  disabled,
}: {
  onSend: (text: string, mode: RelayMode) => void;
  mode: RelayMode;
  onModeChange: (mode: RelayMode) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");

  function send(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed, mode);
    setText("");
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
            className="rounded-full border border-slate-600 px-3 py-1 text-sm text-slate-200"
          >
            {phrase}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(text);
          }
        }}
        aria-label="Type what you want said"
        placeholder="Type here. Enter speaks it."
        className="min-h-24 rounded-lg border border-slate-600 bg-slate-900 p-3 text-lg text-slate-100"
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mode === "assistant"}
          disabled={disabled}
          onChange={(e) => onModeChange(e.target.checked ? "assistant" : "verbatim")}
        />
        <span className={mode === "assistant" ? "font-semibold text-amber-300" : "text-slate-300"}>
          {mode === "assistant"
            ? "ASSISTANT IS SPEAKING — it handles menus and hold, and never answers for you"
            : "Assistant mode (menus and hold only) — off"}
        </span>
      </label>
    </section>
  );
}
