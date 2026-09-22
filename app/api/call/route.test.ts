import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { resetRateLimits } from "@/lib/rate-limit";

const ORIGINAL_ENV = { ...process.env };

/** Distinct addresses keep the shared limiter from bleeding between tests. */
function call(ip = "203.0.113.1", init: RequestInit = {}) {
  return new Request("https://aloud.example/api/call", {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...(init.headers ?? {}) },
    ...init,
  });
}

describe("POST /api/call — agent update failure", () => {
  beforeEach(() => {
    resetRateLimits();
    process.env.ASSEMBLYAI_API_KEY = "test-api-key";
    process.env.ALOUD_LLM_SHARED_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_ORIGIN = "https://aloud.example";
    delete process.env.ALOUD_DEMO_CODE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("surfaces an error instead of silently succeeding when the PUT to reuse an existing agent fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "https://agents.assemblyai.com/v1/agents" && method === "GET") {
        return new Response(
          JSON.stringify({ agents: [{ id: "agent_existing", name: "aloud-relay" }] }),
          { status: 200 },
        );
      }

      if (url === "https://agents.assemblyai.com/v1/agents/agent_existing" && method === "PUT") {
        // Simulate the update failing — the stale config must not be reported as success.
        return new Response("server error", { status: 500 });
      }

      throw new Error(`unexpected fetch in test: ${method} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(call());
    const body = await response.json();

    // Must not return the 200 { token, agentId } success shape when the update failed.
    expect(response.status).not.toBe(200);
    expect(body.agentId).toBeUndefined();
    // The client-facing message must be generic: the upstream body (and status)
    // are logged server-side only, never forwarded, because the request that
    // failed carries our shared secret in its own body (see route.ts).
    expect(body.error).not.toMatch(/server error/i);
    expect(body.error).not.toMatch(/500/);
  });
});

describe("POST /api/call — who is allowed to mint a token", () => {
  beforeEach(() => {
    resetRateLimits();
    process.env.ASSEMBLYAI_API_KEY = "test-api-key";
    process.env.ALOUD_LLM_SHARED_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_ORIGIN = "https://aloud.example";
    delete process.env.ALOUD_DEMO_CODE;
    // Nothing below should reach AssemblyAI: each request is refused before it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("upstream must not be called for a refused request");
      }),
    );
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("refuses a caller without the demo code once one is configured", async () => {
    process.env.ALOUD_DEMO_CODE = "open-sesame";
    const response = await POST(call("203.0.113.2"));
    expect(response.status).toBe(403);
  });

  it("accepts the demo code on a header", async () => {
    process.env.ALOUD_DEMO_CODE = "open-sesame";
    const response = await POST(call("203.0.113.3", { headers: { "x-aloud-code": "open-sesame" } }));
    expect(response.status).not.toBe(403);
  });

  it("accepts the demo code in the body", async () => {
    process.env.ALOUD_DEMO_CODE = "open-sesame";
    const response = await POST(
      call("203.0.113.4", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "open-sesame" }),
      }),
    );
    expect(response.status).not.toBe(403);
  });

  it("stays open when no demo code is configured, so a judge's link just works", async () => {
    const response = await POST(call("203.0.113.5"));
    expect(response.status).not.toBe(403);
  });

  it("skips agent reuse entirely when the client reports the stored id did not resolve", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(`${init?.method ?? "GET"} ${String(input)}`);
        if (String(input).startsWith("https://agents.assemblyai.com/v1/agents")) {
          return new Response(JSON.stringify({ id: "agent_fresh" }), { status: 201 });
        }
        return new Response(JSON.stringify({ token: "tok" }), { status: 200 });
      }),
    );

    const response = await POST(
      call("203.0.113.7", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recreate: true }),
      }),
    );

    expect(await response.json()).toMatchObject({ agentId: "agent_fresh" });
    // The LIST that would have handed back the same unreachable id must not run.
    expect(seen).not.toContain("GET https://agents.assemblyai.com/v1/agents");
  });

  it("rate-limits a caller minting tokens in a loop, and says when to retry", async () => {
    // CALL_LIMIT — raised to 12 so a full connectWithRecovery retry burst
    // (up to 3 /api/call requests) across a couple of real attempts fits.
    for (let i = 0; i < 12; i++) await POST(call("203.0.113.6"));
    const response = await POST(call("203.0.113.6"));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
