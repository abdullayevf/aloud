// scripts/gate-probe.mjs
// Node 22+ (needs a global WebSocket — it is only stable from Node 21).
//
// Usage:
//   node scripts/gate-probe.mjs https://<deployment>          (G1/G3/G4 pass — sends a real utterance)
//   node scripts/gate-probe.mjs https://<deployment> --idle   (G2 pass — no mic here, so this sends
//                                                               reply.create with nothing pending and
//                                                               watches whether the agent talks anyway)
//
// ENVIRONMENT ADAPTATION (see task-5-report.md for full evidence):
// AssemblyAI's REST agents API and WS gateway appear to be region-affinitized in this
// environment: an agent created via a request from Vercel's network is invisible (404 on
// GET, absent from list) to WS connections and REST calls made from this sandbox's network,
// and vice versa, symmetrically and durably (observed over 30+ minutes with no convergence,
// confirmed with both `fetch` and raw `curl`, confirmed against `agents.assemblyai.com`
// directly with no CDN in the response path). Calling `${origin}/api/call` for the agentId
// (as the brief's original script does) therefore deterministically fails with
// `session.error` / `agent_not_found` from this machine, even though the deployed
// `/api/call` route itself is correct and unmodified.
//
// Workaround: this script still calls `${origin}/api/call` to mint the token (token minting
// is unaffected — it is not agent-scoped), but creates its OWN throwaway agent directly
// against the AssemblyAI Agents API, from the same network vantage point as the WS
// connection below, using the exact same payload shape as lib/agent-config.ts
// buildAgentPayload() (same greeting, system_prompt, voice, input/output config, and
// crucially the same llm.base_url pointing at OUR real deployed /api/llm/v1 route). This
// still fully exercises the thing Task 5 cares about — our deployed endpoint via a real
// AssemblyAI WS session — without depending on the region-locked lookup.
// Requires ASSEMBLYAI_API_KEY and ALOUD_LLM_SHARED_SECRET in the environment (e.g. `env
// $(cat .env.local | xargs) node scripts/gate-probe.mjs ...`, or export them beforehand).
const origin = process.argv[2];
const idle = process.argv.includes("--idle");
if (!origin) throw new Error("usage: node scripts/gate-probe.mjs https://<deployment> [--idle]");

// Fall back to reading .env.local directly if the caller hasn't exported the vars.
if (!process.env.ASSEMBLYAI_API_KEY || !process.env.ALOUD_LLM_SHARED_SECRET) {
  try {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env.local; the checks below will report what's still missing.
  }
}

const apiKey = process.env.ASSEMBLYAI_API_KEY;
const sharedSecret = process.env.ALOUD_LLM_SHARED_SECRET;
if (!apiKey || !sharedSecret) {
  throw new Error("ASSEMBLYAI_API_KEY and ALOUD_LLM_SHARED_SECRET must be set in the environment (or in .env.local)");
}

const RELAY_GREETING =
  "Hello. You're on a relay call. The person you're speaking with types, and I read what they type out loud. Please speak normally.";
const ASSISTANT_SYSTEM_PROMPT = `You are an automated relay assistant on a live phone call. The person you are helping is deaf and communicates by typing.

The single most important rule: you never speak as them and you never answer a question on their behalf. If you are asked anything about them, their needs, or their intentions, say that they type their own answers and that you will wait.

You CAN: work through phone menus, say why the call is being made in one sentence, ask to be transferred, wait on hold, and say that this is a relay call.
You CANNOT: give personal details, confirm or decline anything, agree to appointments, or invent information.

If asked who you are: "I'm an automated assistant on a relay call. The caller types and their words are read out."

Speak in short, plain sentences. Never use markdown. Read digits one at a time.`;

async function createProbeAgent() {
  const payload = {
    name: `aloud-relay-gateprobe-${Date.now()}`,
    greeting: RELAY_GREETING,
    system_prompt: ASSISTANT_SYSTEM_PROMPT,
    voice: { voice_id: "jane" },
    input: {
      format: { encoding: "audio/pcm" },
      transcription_mode: "balanced",
      voice_focus: "far-field",
    },
    output: { format: { encoding: "audio/pcm" }, volume: 100 },
    tools: [],
    llm: [{ base_url: `${origin}/api/llm/v1`, model: "aloud-verbatim", api_key: sharedSecret }],
  };
  const res = await fetch("https://agents.assemblyai.com/v1/agents", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`probe agent create failed (${res.status}): ${await res.text()}`);
  const { id } = await res.json();
  return id;
}

async function deleteProbeAgent(id) {
  await fetch(`https://agents.assemblyai.com/v1/agents/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => {});
}

const { token } = await (await fetch(`${origin}/api/call`, { method: "POST" })).json();
const agentId = await createProbeAgent();
console.log("agent", agentId, "(created directly, same network path as this WS connection)");
console.log("mode", idle ? "idle (G2)" : "utterance (G1/G3/G4)");

const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
const t0 = Date.now();
let replyCreateSentAt = null;
let firstReplyAudioAt = null;
let sawAgentSpeech = false;
// Turn 1 is always the configured `greeting`, spoken straight to TTS regardless of
// what's queued (confirmed empirically: its /api/llm request body carries only the
// system message, no conversation history). The sentinel-tagged test message is sent
// for turn 2, after turn 1's reply.done, so it's the turn actually under test.
let turn = 0;

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "session.update", session: { agent_id: agentId } }));
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  console.log(`+${Date.now() - t0}ms`, msg.type, msg.type === "transcript.agent" ? msg.text : "");
  if (msg.type === "session.error" || msg.type === "error") {
    console.log("full error payload", JSON.stringify(msg, null, 2));
  }

  if (msg.type === "session.ready") {
    console.log("session", msg.session_id);
    console.log("resolved config", JSON.stringify(msg.config, null, 2));
    turn = 1;
    console.log("--- turn 1 (greeting) ---");
    ws.send(JSON.stringify({ type: "reply.create" }));
  }

  if (msg.type === "reply.audio" && turn === 2 && firstReplyAudioAt === null) {
    firstReplyAudioAt = Date.now();
    console.log("G3: reply.create -> first reply.audio =", firstReplyAudioAt - replyCreateSentAt, "ms");
  }

  if (msg.type === "transcript.agent") {
    sawAgentSpeech = true;
  }

  if (msg.type === "reply.done" && turn === 1) {
    console.log("turn 1 (greeting) done.");
    if (idle) {
      // G2: nothing pending, just ask for another reply and see if the agent stays silent.
      turn = 2;
      console.log("--- turn 2 (idle — nothing pending) ---");
      sawAgentSpeech = false;
      replyCreateSentAt = Date.now();
      ws.send(JSON.stringify({ type: "reply.create" }));
    } else {
      // G1/G3/G4: queue the sentinel-tagged utterance, then ask for a reply.
      // A deliberate gap before reply.create rules out a race where the server
      // hasn't yet committed conversation.message to history.
      turn = 2;
      console.log("--- turn 2 (sentinel utterance) ---");
      sawAgentSpeech = false;
      ws.send(JSON.stringify({
        type: "conversation.message",
        role: "user",
        content: "\u0001SAY\u0001Testing one two three. 415 555 0134.",
      }));
      setTimeout(() => {
        replyCreateSentAt = Date.now();
        ws.send(JSON.stringify({ type: "reply.create" }));
      }, 800);
    }
  } else if (msg.type === "reply.done" && turn === 2) {
    console.log("turn 2 done. sawAgentSpeech =", sawAgentSpeech, "firstReplyAudioAt =", firstReplyAudioAt === null ? "(none)" : `${firstReplyAudioAt - replyCreateSentAt}ms`);
    ws.send(JSON.stringify({ type: "session.end" }));
  }

  if (msg.type === "session.ended") {
    console.log("duration", msg.session_duration_seconds);
    ws.close();
  }
});

ws.addEventListener("close", async (event) => {
  console.log("ws closed", event.code, event.reason || "(no reason)");
  await deleteProbeAgent(agentId);
  console.log("probe agent deleted");
});

ws.addEventListener("error", (event) => {
  console.log("ws error", event.message ?? event);
});
