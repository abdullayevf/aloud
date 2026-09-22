import { timingSafeEqual } from "node:crypto";
import { buildVerbatimSSE } from "@/lib/openai-sse";
import { decodeOutbound } from "@/lib/sentinel";

export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  Connection: "keep-alive",
};

type Content = string | { text?: string }[] | null;
interface Message { role: string; content?: Content }

/**
 * AssemblyAI's own BYO-LLM reference server accepts the key on either header
 * and strips a Bearer prefix. Mirror it: a 401 here presents as the agent
 * silently never speaking, which is the worst thing to debug on a live call.
 */
function authorized(request: Request): boolean {
  const secret = process.env.ALOUD_LLM_SHARED_SECRET;
  if (!secret) return false;
  // Headers.get() returns "" (not null) for a present-but-empty header, so `??`
  // would not fall through to x-api-key in that case. Use `||` instead.
  const header =
    request.headers.get("authorization") || request.headers.get("x-api-key") || "";
  const provided = header.replace(/^Bearer\s+/i, "").trim();

  // Constant-time comparison: timingSafeEqual throws on unequal-length buffers,
  // so compare lengths first. Leaking the length alone is not sensitive here.
  const providedBuf = Buffer.from(provided, "utf8");
  const secretBuf = Buffer.from(secret, "utf8");
  if (providedBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(providedBuf, secretBuf);
}

/** `content` may arrive as a string or as an array of parts. Handle both or the sentinel is missed. */
function textOf(content: Content): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").join("");
  return "";
}

/**
 * The pending utterance is the last sentinel-tagged user message that has not
 * yet been followed by an assistant turn. If the agent has already spoken since
 * it was typed, it is done and we must stay silent — otherwise every reply the
 * hearing party triggers would repeat the user's last sentence.
 *
 * Known limitation: this only ever returns the LAST such message. If two
 * utterances are typed before the agent replies to the first, the earlier one
 * is silently never spoken — there is no queue. Fixing this depends on a design
 * not yet made (does the client enforce one-utterance-in-flight, or should this
 * route concatenate pending utterances?), so it is deliberately left as-is here.
 * Deferred to the client (Task 10) or a Path B design — see
 * docs/superpowers/specs/2026-09-22-aloud-design.md §3.2.
 */
function pendingUtterance(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "assistant") return null;
    if (message.role !== "user") continue;
    const decoded = decodeOutbound(textOf(message.content ?? ""));
    if (decoded) return decoded;
  }
  return null;
}

function stream(frames: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f));
        controller.close();
      },
    }),
    { headers: SSE_HEADERS },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = `aloud-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  let payload: { model?: string; messages?: Message[] };
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("payload is not an object");
    payload = parsed as { model?: string; messages?: Message[] };
  } catch {
    // Malformed or absent body. Nothing to say — same "stay silent" behavior
    // as the no-pending-utterance case, never a bare 500 that leaves the
    // agent with no well-formed stream to fall back on (G2).
    return stream(buildVerbatimSSE("", "aloud-verbatim", id, created));
  }

  const model = payload.model ?? "aloud-verbatim";
  const pending = pendingUtterance(payload.messages ?? []);

  // Nothing to say. Silence is the correct output for a relay with no pending
  // utterance — see spec §3.2 gate G2.
  if (!pending) return stream(buildVerbatimSSE("", model, id, created));

  // VERBATIM: no model, no rewriting, no inference. This line is the product.
  if (pending.mode === "verbatim") {
    return stream(buildVerbatimSSE(pending.text, model, id, created));
  }

  // ASSISTANT: the user explicitly delegated. Proxy to the LLM Gateway.
  return proxyToGateway(payload, model, id, created);
}

async function proxyToGateway(
  payload: { messages?: Message[] },
  model: string,
  id: string,
  created: number,
): Promise<Response> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    // Nothing to authenticate with — go straight to the same fallback the
    // catch below returns, instead of sending a request that can only fail.
    return stream(
      buildVerbatimSSE("The assistant is unavailable. The caller will type.", model, id, created),
    );
  }
  try {
    const upstream = await fetch("https://llm-gateway.assemblyai.com/v1/chat/completions", {
      method: "POST",
      // Unlike agents.assemblyai.com, the LLM Gateway host takes the raw key with
      // no Bearer prefix (docs/assemblyai-integration.md, LLM Gateway section).
      headers: { Authorization: `${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        stream: true,
        messages: (payload.messages ?? []).map((m) => ({
          role: m.role,
          content: textOf(m.content ?? "").replace(/\u0001[A-Z]+\u0001/g, ""),
        })),
      }),
    });
    if (!upstream.ok || !upstream.body) throw new Error(`gateway ${upstream.status}`);
    return new Response(upstream.body, { headers: SSE_HEADERS });
  } catch {
    // Never leave the line silent on an assistant failure: say one fixed
    // sentence and let the UI drop back to verbatim.
    return stream(
      buildVerbatimSSE("The assistant is unavailable. The caller will type.", model, id, created),
    );
  }
}
