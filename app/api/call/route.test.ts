import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const ORIGINAL_ENV = { ...process.env };

describe("POST /api/call — agent update failure", () => {
  beforeEach(() => {
    process.env.ASSEMBLYAI_API_KEY = "test-api-key";
    process.env.ALOUD_LLM_SHARED_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_ORIGIN = "https://aloud.example";
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

    const response = await POST();
    const body = await response.json();

    // Must not return the 200 { token, agentId } success shape when the update failed.
    expect(response.status).not.toBe(200);
    expect(body.agentId).toBeUndefined();
    expect(body.error).toMatch(/agent update failed/i);
    expect(body.error).toMatch(/500/);
  });
});
