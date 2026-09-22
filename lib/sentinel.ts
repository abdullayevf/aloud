export type RelayMode = "verbatim" | "assistant";

/** U+0001 START OF HEADING. Never typed by a human, never produced by our UI. */
const SOH = "\u0001";
const TAGS: Record<RelayMode, string> = { verbatim: "SAY", assistant: "ASSIST" };
const END = `${SOH}END${SOH}`;

/**
 * Wraps the user's text so it survives the trip through AssemblyAI and arrives
 * identifiable in the chat-completions request body. The control character is
 * stripped from the payload so a user cannot type their way into another mode
 * — or forge a terminator.
 *
 * The text travels as `reply.create { instructions }`, which was measured on
 * 2026-09-22 to arrive byte-identical as the last `messages` entry with
 * `role: "system"` (docs/research/gate-results-2026-09-22.md, G1 re-probe).
 * The closing terminator is not required by that measurement — content arrives
 * unwrapped today — but it costs nothing and it is the difference between
 * working and silently mis-speaking if AssemblyAI ever pads the instruction
 * with text of its own.
 */
export function encodeOutbound(mode: RelayMode, text: string): string {
  return `${SOH}${TAGS[mode]}${SOH}${text.split(SOH).join("")}${END}`;
}

/**
 * Finds the payload anywhere in `content`, not only at the start, so a wrapped
 * instruction still decodes. Text runs to the terminator; if the terminator is
 * missing it runs to the end, which is what an un-padded arrival looks like.
 */
export function decodeOutbound(content: string): { mode: RelayMode; text: string } | null {
  for (const mode of Object.keys(TAGS) as RelayMode[]) {
    const prefix = `${SOH}${TAGS[mode]}${SOH}`;
    const start = content.indexOf(prefix);
    if (start === -1) continue;
    const from = start + prefix.length;
    const end = content.indexOf(END, from);
    return { mode, text: end === -1 ? content.slice(from) : content.slice(from, end) };
  }
  return null;
}
