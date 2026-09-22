export const dynamic = "force-dynamic";

const ATTEMPTS = [0, 500, 1500, 3000, 5000]; // ~10s total, per spec §5.3

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return Response.json({ error: "not configured" }, { status: 500 });

  const { sessionId } = (await request.json().catch(() => ({}))) as { sessionId?: string };
  if (!sessionId) return Response.json({ error: "sessionId is required" }, { status: 400 });

  let lastStatus = 0;
  for (const wait of ATTEMPTS) {
    if (wait) await sleep(wait);
    const response = await fetch(`https://agents.assemblyai.com/v1/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    lastStatus = response.status;
    // 204 = soft-deleted: it leaves GET /v1/sessions and its artifacts stop resolving.
    if (response.status === 204) {
      return Response.json({ deleted: true, sessionId, at: new Date().toISOString() });
    }
    // A 404 will not become a 204. Stop retrying.
    if (response.status === 404) break;
  }

  return Response.json({ deleted: false, sessionId, status: lastStatus }, { status: 502 });
}
