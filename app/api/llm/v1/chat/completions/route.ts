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
 * The utterance the user typed for THIS reply.
 *
 * It travels as `reply.create { instructions }` and was measured on 2026-09-22
 * to arrive as the last `messages` entry, `role: "system"`, byte-identical
 * (docs/research/gate-results-2026-09-22.md, G1 re-probe). Crucially the
 * arrival is **one-shot**: it is present in its own turn's request body and
 * absent from the next one. So there is no history to walk back through, no
 * already-spoken utterance to guard against re-speaking, and no queue — a
 * request either carries an utterance to say or it does not.
 *
 * The scan runs from the end and accepts any role, because the exact position
 * and role are AssemblyAI's to change; the sentinel is ours. Nothing else in a
 * request body can carry it: the agent's own system prompt never contains it,
 * and assistant history holds the spoken text with the wrapper already removed.
 */
function pendingUtterance(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const decoded = decodeOutbound(textOf(messages[i].content ?? ""));
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
