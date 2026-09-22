import { buildAgentPayload, AGENT_NAME } from "@/lib/agent-config";
import { buildTokenUrl } from "@/lib/token";

export const dynamic = "force-dynamic";

const AGENTS_BASE = "https://agents.assemblyai.com";

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
      if (!updated.ok) throw new Error(`agent update failed (${updated.status}): ${await updated.text()}`);
      return existing.id;
    }
  }

  const created = await fetch(`${AGENTS_BASE}/v1/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify(buildAgentPayload(origin, secret)),
  });
  if (!created.ok) throw new Error(`agent create failed (${created.status}): ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  return id;
}

export async function POST() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  const secret = process.env.ALOUD_LLM_SHARED_SECRET;
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (!apiKey || !secret || !origin) {
    return Response.json({ error: "Server is not configured for calls" }, { status: 500 });
  }

  try {
    const agentId = await ensureAgent(apiKey, origin, secret);

    const upstream = await fetch(buildTokenUrl(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!upstream.ok) {
      return Response.json(
        { error: `Token request failed (${upstream.status}): ${await upstream.text()}` },
        { status: upstream.status },
      );
    }
    const { token } = (await upstream.json()) as { token: string };
    return Response.json({ token, agentId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 502 });
  }
}
