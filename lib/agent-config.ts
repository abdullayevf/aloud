// lib/agent-config.ts

export const AGENT_NAME = "aloud-relay";

/**
 * Spoken verbatim on connect: `greeting` bypasses the LLM entirely and goes
 * straight to TTS. Never write a meta-instruction here — it would be read out.
 * It exists because deaf callers get hung up on (docs/research/pitch-stats.md §5).
 */
export const RELAY_GREETING =
  "Hello. You're on a relay call. The person you're speaking with types, and I read what they type out loud. Please speak normally.";

/**
 * A backstop, and nothing else. No model runs on this call: `llm` below points
 * every request at our own endpoint, which echoes the typed line and never
 * infers. This text exists only so that a model reached by some path we did not
 * build would refuse rather than improvise in the user's name.
 *
 * AssemblyAI appends ~1.2 KB of its own boilerplate to whatever is configured
 * here, so this is a prefix of what any such model would receive, not the whole
 * of it. That is another reason not to depend on it.
 */
export const RELAY_SYSTEM_PROMPT = `You are the voice of a relay call. The person on your side is deaf and types what they want said; their exact words are read out without a model in the path.

You do not compose speech. You never answer for them, never supply a detail they did not type, and never paraphrase. If you are ever asked to produce a reply yourself, say only: "The caller types their own words. Please hold."`;

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
    system_prompt: RELAY_SYSTEM_PROMPT,
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
