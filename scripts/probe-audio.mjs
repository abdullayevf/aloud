// scripts/probe-audio.mjs — EVIDENCE ONLY, not a gate.
//
//   node scripts/probe-audio.mjs https://<deployment>
//
// Answers two questions with measurements instead of guesses:
//
//   Q1 "the first word blurps"  — do reply.audio frames arrive FASTER than
//      real time, or slower? ReplyPlayer schedules frame N at
//      cursor = max(cursor, currentTime) and starts it there, with no lead-in.
//      Any frame that arrives after its scheduled slot has already passed
//      leaves a hole in the output. This prints, per frame, the audio seconds
//      delivered so far against the wall seconds elapsed since the first frame
//      (the "buffer margin"). A margin that touches or goes below zero is an
//      underrun — an audible gap at exactly that point in the sentence.
//
//   Q2 "an interrupted turn is left hanging" — when the hearing party talks
//      over a reply, does the server still emit transcript.agent? The ledger's
//      only way to resolve a row from "speaking…" is that event, so if it never
//      arrives the row is stuck AND the FIFO pairing is permanently offset.
//      Barge-in is triggered by feeding the agent's own greeting audio back in
//      as input.audio: real 24 kHz speech, no microphone needed.
const origin = process.argv[2];
if (!origin) throw new Error("usage: node scripts/probe-audio.mjs https://<deployment>");

if (!process.env.ASSEMBLYAI_API_KEY || !process.env.ALOUD_LLM_SHARED_SECRET) {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const apiKey = process.env.ASSEMBLYAI_API_KEY;
const sharedSecret = process.env.ALOUD_LLM_SHARED_SECRET;

const SOH = "\u0001";
const say = (t) => `${SOH}SAY${SOH}${t.split(SOH).join("")}${SOH}END${SOH}`;
const RATE = 24000;
const GREETING =
  "Hello. You're on a relay call. The person you're speaking with types, and I read what they type out loud. Please speak normally.";
const LONG =
  "I am calling about the appointment on Thursday afternoon and I would like to move it to the following week if that is at all possible for you.";

const res = await fetch("https://agents.assemblyai.com/v1/agents", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: `aloud-audio-probe-${Date.now()}`,
    greeting: GREETING,
    system_prompt: "Relay probe agent. In verbatim mode no model runs.",
    voice: { voice_id: "jane" },
    input: { format: { encoding: "audio/pcm" }, transcription_mode: "balanced", voice_focus: "far-field" },
    output: { format: { encoding: "audio/pcm" }, volume: 100 },
    tools: [],
    llm: [{ base_url: `${origin}/api/llm/v1`, model: "aloud-verbatim", api_key: sharedSecret }],
  }),
});
if (!res.ok) throw new Error(`agent create failed (${res.status}): ${await res.text()}`);
const agentId = (await res.json()).id;

const { token } = await (await fetch(`${origin}/api/call`, { method: "POST" })).json();
const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);

let phase = "greeting"; // greeting -> interrupt -> after -> done
const greetingFrames = []; // base64 frames, reused as fake mic speech
let frames = []; // timing log for the phase in flight
let firstFrameAt = null;
const events = [];
const log = (...a) => console.log(...a);

function startFrameLog() {
  frames = [];
  firstFrameAt = null;
}

function report(label) {
  if (frames.length === 0) return log(`\n[${label}] no reply.audio frames at all`);
  let audioSeconds = 0;
  let worst = Infinity;
  let worstAt = 0;
  log(`\n[${label}] ${frames.length} frames`);
  for (const f of frames) {
    audioSeconds += f.seconds;
    const margin = audioSeconds - f.wall;
    if (margin < worst) {
      worst = margin;
      worstAt = audioSeconds;
    }
  }
  log(`  total audio ${audioSeconds.toFixed(2)}s delivered over ${frames.at(-1).wall.toFixed(2)}s wall`);
  log(`  smallest buffer margin ${(worst * 1000).toFixed(0)} ms, at ${worstAt.toFixed(2)}s into the sentence`);
  log(`  first 8 frames (audio s / wall s / margin ms):`);
  let acc = 0;
  for (const f of frames.slice(0, 8)) {
    acc += f.seconds;
    log(`    +${f.seconds.toFixed(3)}s  audio ${acc.toFixed(3)}  wall ${f.wall.toFixed(3)}  margin ${((acc - f.wall) * 1000).toFixed(0)} ms`);
  }
  return worst;
}

/** Feed real speech (the agent's own greeting) back in, in 20 ms-ish chunks. */
async function bargeIn() {
  // Mid-greeting frames: continuous speech, not the leading "Hello." plus
  // silence. Paced at 10 ms to match the 10 ms/frame the server itself sends,
  // i.e. real time — starved audio reads as noise to the VAD, not as a turn.
  const speech = greetingFrames.slice(150, 450);
  log(`\n>>> feeding ${(speech.length / 100).toFixed(1)}s of real speech into input.audio to force a barge-in`);
  for (const b64 of speech) {
    ws.send(JSON.stringify({ type: "input.audio", audio: b64 }));
    await new Promise((r) => setTimeout(r, 10));
  }
  log(">>> stopped feeding");
}

ws.addEventListener("open", () =>
  ws.send(JSON.stringify({ type: "session.update", session: { agent_id: agentId } })),
);

ws.addEventListener("message", async (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "reply.audio") {
    const bytes = Buffer.from(msg.data, "base64").length;
    const now = Date.now();
    if (firstFrameAt === null) firstFrameAt = now;
    frames.push({ seconds: bytes / 2 / RATE, wall: (now - firstFrameAt) / 1000 });
    if (phase === "greeting") greetingFrames.push(msg.data);
    return;
  }
  if (msg.type === "transcript.agent.delta") return;

  // How far into the spoken audio are we when this event lands? This is the
  // whole question for transcript.agent: a receipt arrives at the END of the
  // sentence, an intent arrives at the start.
  const delivered = frames.reduce((s, f) => s + f.seconds, 0);
  events.push(
    `${phase}: ${msg.type}${msg.status ? ` status=${msg.status}` : ""} @ ${delivered.toFixed(2)}s of audio`,
  );
  log(
    `  · ${phase} [${delivered.toFixed(2)}s audio out] ${msg.type}`,
    msg.type === "transcript.agent"
      ? `interrupted=${msg.interrupted} ${JSON.stringify(msg.text)}`
      : msg.type === "reply.done"
        ? `status=${msg.status}`
        : msg.type === "transcript.user"
          ? JSON.stringify(msg.text)
          : "",
  );

  if (msg.type === "session.ready") {
    startFrameLog();
    ws.send(JSON.stringify({ type: "reply.create" })); // greeting turn
  }

  if (msg.type === "reply.done") {
    if (phase === "greeting") {
      report("greeting — streamed with NO client-side lead-in");
      phase = "interrupt";
      startFrameLog();
      log(`\n--- turn: ${JSON.stringify(LONG)} (will be talked over) ---`);
      ws.send(JSON.stringify({ type: "reply.create", instructions: say(LONG) }));
      setTimeout(bargeIn, 1500); // let a second of it play, then talk over it
      return;
    }
    if (phase === "interrupt") {
      report("interrupted turn");
      phase = "after";
      startFrameLog();
      log(`\n--- next turn after the interruption ---`);
      ws.send(JSON.stringify({ type: "reply.create", instructions: say("Please repeat that.") }));
      return;
    }
    if (phase === "after") {
      phase = "done";
      setTimeout(() => ws.send(JSON.stringify({ type: "session.end" })), 500);
    }
  }

  if (msg.type === "session.ended") ws.close();
});

ws.addEventListener("close", async () => {
  await fetch(`https://agents.assemblyai.com/v1/agents/${agentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => {});
  log("\n================ event order ================");
  for (const e of events) log(" ", e);
  log("\nprobe agent deleted");
});
