// lib/agent-config.ts

export const AGENT_NAME = "aloud-relay";

/**
 * Spoken verbatim on connect: `greeting` bypasses the LLM entirely and goes
 * straight to TTS. Never write a meta-instruction here — it would be read out.
 * It exists because deaf callers get hung up on (docs/research/pitch-stats.md §5).
 */
export const RELAY_GREETING =
  "Hello. You're on a relay call. The person you're speaking with types, and I read what they type out loud. Please speak normally.";

/** Reachable ONLY in assistant mode. In verbatim mode no model runs at all. */
export const ASSISTANT_SYSTEM_PROMPT = `You are an automated relay assistant on a live phone call. The person you are helping is deaf and communicates by typing.

The single most important rule: you never speak as them and you never answer a question on their behalf. If you are asked anything about them, their needs, or their intentions, say that they type their own answers and that you will wait.

You CAN: work through phone menus, say why the call is being made in one sentence, ask to be transferred, wait on hold, and say that this is a relay call.
You CANNOT: give personal details, confirm or decline anything, agree to appointments, or invent information.

If asked who you are: "I'm an automated assistant on a relay call. The caller types and their words are read out."

Speak in short, plain sentences. Never use markdown. Read digits one at a time.`;

export function buildAgentPayload(origin: string, sharedSecret: string) {
  if (!origin.startsWith("https://") || /localhost|127\.0\.0\.1/.test(origin)) {
    throw new Error(`base_url must be a public https origin, got: ${origin}`);
  }
  // Strip trailing slash(es) so base_url never ends up with a double slash
  // (e.g. "https://foo.vercel.app/" -> ".../api/llm/v1", not ".../..//api/llm/v1").
  // A double slash here is a 404 that presents as "the agent silently never speaks".
  origin = origin.replace(/\/+$/, "");

  return {
    name: AGENT_NAME,
    greeting: RELAY_GREETING,
    system_prompt: ASSISTANT_SYSTEM_PROMPT,
    voice: { voice_id: "jane" },
    input: {
      format: { encoding: "audio/pcm" },
      transcription_mode: "balanced",
      // far-field: the hearing party is a speakerphone in the room, not a headset.
      voice_focus: "far-field",
      // language_codes and turn_detection are DELIBERATELY absent.
    },
    output: { format: { encoding: "audio/pcm" }, volume: 100 },
    tools: [],
    // The agent calls `{base_url}/chat/completions`, and base_url conventionally
    // ends in /v1 (the docs' example is https://api.openai.com/v1, and
    // AssemblyAI's own BYO-LLM demo publishes `${TUNNEL}/v1`). Dropping the /v1
    // here while the route keeps it is a 404 that looks like the agent going mute.
    llm: [{ base_url: `${origin}/api/llm/v1`, model: "aloud-verbatim", api_key: sharedSecret }],
  };
}
