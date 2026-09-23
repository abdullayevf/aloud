"use client";

/**
 * The demo is a real phone call: the laptop is the relay, a phone on speaker
 * beside it is the line, and the hearing party is a real person somewhere
 * else. Interface spec §1.1. Without this card the screen reads as two people
 * sitting at one laptop, which is not the product.
 */
const STEPS = [
  "Dial the number on your phone.",
  "Put the phone on speaker.",
  "Set it beside this laptop, screen up.",
  "Start the call here — your words come out of this laptop, into the phone.",
];

export function CallSetup({ onStart, connecting }: { onStart: () => void; connecting: boolean }) {
  return (
    <section aria-label="Before you start" className="flex flex-col gap-8">
      <p className="measure text-3xl leading-snug text-ink">
        You type. Your words are spoken on the line, exactly as you wrote them. The other person
        talks, and you read it here.
      </p>

      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-lg text-dim">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-sm text-mute">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <button
        onClick={onStart}
        disabled={connecting}
        className="self-start rounded-lg bg-ink px-6 py-3 text-lg font-bold text-paper disabled:opacity-60"
      >
        {connecting ? "Connecting…" : "Start the call"}
      </button>
    </section>
  );
}
