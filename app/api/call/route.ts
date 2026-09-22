import { buildAgentPayload, AGENT_NAME } from "@/lib/agent-config";
import { buildTokenUrl } from "@/lib/token";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const AGENTS_BASE = "https://agents.assemblyai.com";

/** Five calls per five minutes per caller. A demo places one call at a time. */
const CALL_LIMIT = 5;
const CALL_WINDOW_MS = 5 * 60 * 1000;

/**
 * The demo code is optional on purpose: unset, the route is open, which is what
 * a judge following a link needs. Set it before posting the link anywhere
 * public. This gates token minting, not the product.
 */
function codeAccepted(request: Request, body: { code?: unknown }): boolean {
  const expected = process.env.ALOUD_DEMO_CODE;
  if (!expected) return true;
  const provided = request.headers.get("x-aloud-code") ?? (typeof body.code === "string" ? body.code : "");
  return provided === expected;
}

async function ensureAgent(apiKey: string, origin: string, secret: string): Promise<string> {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // The list response is lightweight: id, name, timestamps. Enough to reuse.
  const list = await fetch(`${AGENTS_BASE}/v1/agents`, { headers, cache: "no-store" });
  if (list.ok) {
    const { agents = [] } = (await list.json()) as { agents?: { id: string; name: string }[] };
    const existing = agents.find((a) => a.name === AGENT_NAME);
    if (existing) {
      // PUT so a redeployed origin or a rotated secret takes effect.
      const updated = await fetch(`${AGENTS_BASE}/v1/agents/${existing.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(buildAgentPayload(origin, secret)),
      });
      if (!updated.ok) {
        // Never forward raw upstream body to the client: the request we just sent
        // carries our shared secret in llm[0].api_key, and a FastAPI 422 response
        // echoes the offending input by default. Log server-side only.
        console.error(`agent update failed (${updated.status}): ${await updated.text()}`);
        throw new Error("agent update failed");
      }
      return existing.id;
    }
  }

  const created = await fetch(`${AGENTS_BASE}/v1/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify(buildAgentPayload(origin, secret)),
  });
  if (!created.ok) {
    // Same reasoning as above: the create body also carries the shared secret.
    console.error(`agent create failed (${created.status}): ${await created.text()}`);
    throw new Error("agent create failed");
  }
  const { id } = (await created.json()) as { id: string };
  return id;
}

export async function POST(request: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  const secret = process.env.ALOUD_LLM_SHARED_SECRET;
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (!apiKey || !secret || !origin) {
    return Response.json({ error: "Server is not configured for calls" }, { status: 500 });
  }

  // A body is optional — the browser may post nothing at all.
  const body = await request.json().catch(() => ({}));
  if (!codeAccepted(request, body as { code?: unknown })) {
    return Response.json({ error: "This demo needs an access code" }, { status: 403 });
  }

  const limited = rateLimit(clientKey(request), CALL_LIMIT, CALL_WINDOW_MS);
  if (!limited.ok) {
    return Response.json(
      { error: "Too many calls started from here. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  try {
    const agentId = await ensureAgent(apiKey, origin, secret);

    const upstream = await fetch(buildTokenUrl(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!upstream.ok) {
      // Do not forward the upstream body to the client — same reasoning as the
      // agent create/update paths above. Log server-side only.
      console.error(`token request failed (${upstream.status}): ${await upstream.text()}`);
      return Response.json({ error: "Could not start the call" }, { status: upstream.status });
    }
    const { token } = (await upstream.json()) as { token: string };
    return Response.json({ token, agentId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // `error` may embed upstream response text (e.g. our own thrown Errors
    // above, or a network error). Never return it to the client — log only.
    console.error("agent create/update or token request failed:", error);
    return Response.json({ error: "Could not start the call" }, { status: 502 });
  }
}
