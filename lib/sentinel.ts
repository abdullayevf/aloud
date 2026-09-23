/** U+0001 START OF HEADING. Never typed by a human, never produced by our UI. */
const SOH = "\u0001";
const TAG = `${SOH}SAY${SOH}`;
const END = `${SOH}END${SOH}`;

/**
 * Wraps the user's text so it survives the trip through AssemblyAI and arrives
 * identifiable in the chat-completions request body. The control character is
 * stripped from the payload so a user cannot forge a terminator by typing one.
 *
 * The text travels as `reply.create { instructions }`, which was measured on
 * 2026-09-22 to arrive byte-identical as the last `messages` entry with
 * `role: "system"` (docs/research/gate-results-2026-09-22.md, G1 re-probe).
 * The closing terminator is not required by that measurement — content arrives
 * unwrapped today — but it costs nothing and it is the difference between
 * working and silently mis-speaking if AssemblyAI ever pads the instruction
 * with text of its own.
 *
 * There is one tag, because there is one mode. Assistant mode was deleted on
 * 2026-09-23 (see lib/agent-config.ts); the wire format is unchanged from the
 * one the five gates were measured against, byte for byte.
 */
export function encodeOutbound(text: string): string {
  return `${TAG}${text.split(SOH).join("")}${END}`;
}

/**
 * Finds the payload anywhere in `content`, not only at the start, so a wrapped
 * instruction still decodes. Text runs to the terminator; if the terminator is
 * missing it runs to the end, which is what an un-padded arrival looks like.
 *
 * Returns `null` for "no utterance here" and `""` for "an utterance that is
 * empty" — two different things that produce the same silence downstream.
 * Callers must test `=== null`, never truthiness.
 */
export function decodeOutbound(content: string): string | null {
  const start = content.indexOf(TAG);
  if (start === -1) return null;
  const from = start + TAG.length;
  const end = content.indexOf(END, from);
  return end === -1 ? content.slice(from) : content.slice(from, end);
}
