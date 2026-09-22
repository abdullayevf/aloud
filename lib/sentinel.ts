export type RelayMode = "verbatim" | "assistant";

/** U+0001 START OF HEADING. Never typed by a human, never produced by our UI. */
const SOH = "\u0001";
const TAGS: Record<RelayMode, string> = { verbatim: "SAY", assistant: "ASSIST" };

/**
 * Wraps the user's text so it survives the trip through AssemblyAI and arrives
 * identifiable in the chat-completions request body. The control character is
 * stripped from the payload so a user cannot type their way into another mode.
 */
export function encodeOutbound(mode: RelayMode, text: string): string {
  return `${SOH}${TAGS[mode]}${SOH}${text.split(SOH).join("")}`;
}

export function decodeOutbound(content: string): { mode: RelayMode; text: string } | null {
  for (const mode of Object.keys(TAGS) as RelayMode[]) {
    const prefix = `${SOH}${TAGS[mode]}${SOH}`;
    if (content.startsWith(prefix)) return { mode, text: content.slice(prefix.length) };
  }
  return null;
}
