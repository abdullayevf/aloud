// scripts/probe-overlap.mjs — EVIDENCE ONLY.
//
//   node scripts/probe-overlap.mjs https://<deployment>
//
// The composer is enabled the moment the mic starts, but the greeting runs for
// ~8 seconds. So a user's first typed line routinely lands while a reply is
// already in flight. What does the server do with a reply.create sent during
// an active reply — speak it after, or drop it? If it drops it, that line is
// never spoken and its ledger row is stuck on "speaking…" forever.
const origin = process.argv[2];
if (!origin) throw new Error("usage: node scripts/probe-overlap.mjs https://<deployment>");

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
const say = (t) => `${SOH}SAY${SOH}${t}${SOH}END${SOH}`;
const A = "This is the first sentence, which is deliberately quite long so that the second one arrives while it is still being spoken.";
const B = "This is the second sentence.";

const res = await fetch("https://agents.assemblyai.com/v1/agents", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: `aloud-overlap-probe-${Date.now()}`,
    greeting: "Hello.",
    system_prompt: "Relay probe agent.",
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

const t0 = Date.now();
const spoken = [];
let sentB = false;
let done = 0;

ws.addEventListener("open", () =>
  ws.send(JSON.stringify({ type: "session.update", session: { agent_id: agentId } })),
);

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "reply.audio" || msg.type === "transcript.agent.delta") return;
  console.log(
    `+${Date.now() - t0}ms ${msg.type}`,
    msg.type === "transcript.agent" ? `interrupted=${msg.interrupted} ${JSON.stringify(msg.text)}` : msg.status ?? "",
  );

  if (msg.type === "session.ready") {
    console.log("\n--- A sent ---");
    ws.send(JSON.stringify({ type: "reply.create", instructions: say(A) }));
    // B lands squarely in the middle of A, exactly as a real second line would.
    setTimeout(() => {
      console.log("--- B sent, while A is still speaking ---");
      ws.send(JSON.stringify({ type: "reply.create", instructions: say(B) }));
      sentB = true;
    }, 2500);
  }

  if (msg.type === "transcript.agent") spoken.push(msg.text);

  if (msg.type === "reply.done") {
    done += 1;
    // Wait past any late second reply before calling it: absence is the finding.
    if (sentB && done >= 2) setTimeout(() => ws.send(JSON.stringify({ type: "session.end" })), 1000);
    else if (sentB) setTimeout(() => ws.send(JSON.stringify({ type: "session.end" })), 6000);
  }

  if (msg.type === "session.ended") ws.close();
});

ws.addEventListener("close", async () => {
  await fetch(`https://agents.assemblyai.com/v1/agents/${agentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => {});
  console.log("\n================ what was actually spoken ================");
  spoken.forEach((s, i) => console.log(`  ${i}: ${JSON.stringify(s)}`));
  console.log(`\nA spoken: ${spoken.some((s) => s.includes("first sentence"))}`);
  console.log(`B spoken: ${spoken.some((s) => s.includes("second sentence"))}`);
  console.log("probe agent deleted");
});
