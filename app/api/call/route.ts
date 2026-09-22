import { buildTokenUrl } from "@/lib/token";

// Tokens are single-use and short-lived. Caching this hands every visitor a dead token.
export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ASSEMBLYAI_API_KEY is not set on the server" }, { status: 500 });
  }

  const upstream = await fetch(buildTokenUrl(), {
    // Bearer IS required on agents.assemblyai.com, unlike api.assemblyai.com.
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
  return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
