// scripts/gate-probe.mjs
// Node 22+ (needs a global WebSocket — it is only stable from Node 21).
//
// Usage:
//   node scripts/gate-probe.mjs https://<deployment>          G1/G3/G4 — speaks real utterances
//   node scripts/gate-probe.mjs https://<deployment> --idle   G2 — asks for a reply with nothing pending
//
// Requires ASSEMBLYAI_API_KEY and ALOUD_LLM_SHARED_SECRET in the environment or
// in .env.local.
//
// THE MECHANISM UNDER TEST (measured 2026-09-22, see
// docs/research/gate-results-2026-09-22.md): the typed text travels as
// `reply.create { instructions }`. It arrives as the LAST `messages` entry with
// role "system", byte-identical and one-shot. An earlier version of this script
// tested `conversation.message`, which never reaches a custom LLM's request body
// at all; that path is gone from the design and from here.
//
// ENVIRONMENT ADAPTATION: AssemblyAI's REST agents API and WS gateway have been
// observed region-affinitized — an agent created from Vercel's network can be
// invisible (404 on GET, absent from list, `agent_not_found` on the socket) to
// calls from this machine's network, durably. So this script mints its token via
// `${origin}/api/call` (token minting is not agent-scoped and is unaffected) but
// creates its OWN throwaway agent directly, from the same network vantage point
// as the WebSocket below, pointing at the real deployed /api/llm/v1 route. It
// deletes that agent on close.
const origin = process.argv[2];
const idle = process.argv.includes("--idle");
if (!origin) throw new Error("usage: node scripts/gate-probe.mjs https://<deployment> [--idle]");

if (!process.env.ASSEMBLYAI_API_KEY || !process.env.ALOUD_LLM_SHARED_SECRET) {
  try {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    // no .env.local; the check below reports what is still missing.
  }
}

const apiKey = process.env.ASSEMBLYAI_API_KEY;
const sharedSecret = process.env.ALOUD_LLM_SHARED_SECRET;
if (!apiKey || !sharedSecret) {
  throw new Error("ASSEMBLYAI_API_KEY and ALOUD_LLM_SHARED_SECRET must be set (env or .env.local)");
}

const SOH = "\u0001";
const say = (text) => `${SOH}SAY${SOH}${text.split(SOH).join("")}${SOH}END${SOH}`;

// G4 asks whether `transcript.agent.text` can be diffed against what we sent, or
// whether TTS normalisation alters it. The phone number is the case spec §3.2
// flags by name.
const UTTERANCES = [
  "I'd like to reschedule Thursday's appointment.",
  "My number is 415 555 0134.",
  "Yes — that's right, and please call back after five.",
];

/** Spec §3.3: trim, collapse whitespace, drop trailing sentence punctuation, casefold. */
const normalise = (s) =>
  s.trim().replace(/\s+/g, " ").replace(/[.!?,;:]+$/g, "").toLowerCase();

const RELAY_GREETING =
  "Hello. You're on a relay call. The person you're speaking with types, and I read what they type out loud. Please speak normally.";

async function createProbeAgent() {
  const res = await fetch("https://agents.assemblyai.com/v1/agents", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `aloud-relay-gateprobe-${Date.now()}`,
      greeting: RELAY_GREETING,
      system_prompt: "Relay probe agent. In verbatim mode no model runs.",
      voice: { voice_id: "jane" },
      input: { format: { encoding: "audio/pcm" }, transcription_mode: "balanced", voice_focus: "far-field" },
      output: { format: { encoding: "audio/pcm" }, volume: 100 },
      tools: [],
      llm: [{ base_url: `${origin}/api/llm/v1`, model: "aloud-verbatim", api_key: sharedSecret }],
    }),
  });
  if (!res.ok) throw new Error(`probe agent create failed (${res.status}): ${await res.text()}`);
  return (await res.json()).id;
}

const { token } = await (await fetch(`${origin}/api/call`, { method: "POST" })).json();
const agentId = await createProbeAgent();
console.log("agent", agentId, "-> llm.base_url", `${origin}/api/llm/v1`);
console.log("mode", idle ? "idle (G2)" : "utterance (G1/G3/G4)");

const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
const t0 = Date.now();

let step = -1; // -1 is the greeting turn; 0.. index UTTERANCES
let replyCreateSentAt = null;
let firstReplyAudioAt = null;
const latencies = [];
const spoken = [];

function nextTurn() {
  step += 1;
  if (idle ? step >= 1 : step >= UTTERANCES.length) {
    ws.send(JSON.stringify({ type: "session.end" }));
    return;
  }
  firstReplyAudioAt = null;
  replyCreateSentAt = Date.now();
  if (idle) {
    console.log("\n--- turn: idle, nothing pending (G2) ---");
    ws.send(JSON.stringify({ type: "reply.create" }));
  } else {
    console.log(`\n--- turn ${step}: ${JSON.stringify(UTTERANCES[step])} ---`);
    ws.send(JSON.stringify({ type: "reply.create", instructions: say(UTTERANCES[step]) }));
  }
}

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "session.update", session: { agent_id: agentId } }));
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type !== "reply.audio" && msg.type !== "transcript.agent.delta") {
    console.log(`+${Date.now() - t0}ms`, msg.type, msg.type === "transcript.agent" ? JSON.stringify(msg.text) : "");
  }
  if (msg.type === "session.error") console.log("full error payload", JSON.stringify(msg, null, 2));

  if (msg.type === "session.ready") {
    console.log("session", msg.session_id);
    console.log("--- greeting turn ---");
    ws.send(JSON.stringify({ type: "reply.create" }));
  }

  if (msg.type === "reply.audio" && step >= 0 && firstReplyAudioAt === null) {
    firstReplyAudioAt = Date.now();
    const ms = firstReplyAudioAt - replyCreateSentAt;
    latencies.push(ms);
    console.log(`G3: reply.create -> first reply.audio = ${ms} ms`);
  }

  if (msg.type === "transcript.agent" && step >= 0) spoken[step] = msg.text ?? "";

  if (msg.type === "reply.done") setTimeout(nextTurn, 400);

  if (msg.type === "session.ended") {
    console.log("duration", msg.session_duration_seconds);
    ws.close();
  }
});

ws.addEventListener("error", (e) => console.log("ws error", e.message ?? e));

ws.addEventListener("close", async (event) => {
  console.log("\nws closed", event.code, event.reason || "(no reason)");
  await fetch(`https://agents.assemblyai.com/v1/agents/${agentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => {});
  console.log("probe agent deleted");

  if (idle) {
    const silent = spoken.every((s) => !s);
    console.log(`\nG2: agent stayed silent with nothing pending = ${silent}`);
    return;
  }

  console.log("\n================ G3: added latency ================");
  console.log(latencies.map((l) => `${l} ms`).join(", "), latencies.length ? `· mean ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)} ms` : "");

  console.log("\n================ G4: typed vs spoken ================");
  let allMatch = true;
  UTTERANCES.forEach((typed, i) => {
    const heard = spoken[i] ?? "";
    const exact = heard === typed;
    const match = normalise(heard) === normalise(typed);
    if (!match) allMatch = false;
    console.log(`turn ${i}: ${match ? "MATCH" : "MISMATCH"}${exact ? " (byte-identical)" : " (normalised)"}`);
    console.log(`  typed : ${JSON.stringify(typed)}`);
    console.log(`  spoken: ${JSON.stringify(heard)}`);
  });
  console.log(`\nG4 all match after normalisation: ${allMatch}`);
});
