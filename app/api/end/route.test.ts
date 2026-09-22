import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const request = (body: unknown) =>
  new Request("https://example.com/api/end", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  process.env.ASSEMBLYAI_API_KEY = "key";
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/end", () => {
  it("DELETEs the session and reports success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const res = await POST(request({ sessionId: "sess_1" }));
    expect(await res.json()).toMatchObject({ deleted: true, sessionId: "sess_1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://agents.assemblyai.com/v1/sessions/sess_1");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });

  it("retries a transient failure before giving up", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await (await POST(request({ sessionId: "sess_2" }))).json()).toMatchObject({ deleted: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports failure honestly rather than claiming deletion", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    const res = await POST(request({ sessionId: "sess_3" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ deleted: false, sessionId: "sess_3" });
  });

  it("rejects a request without a session id", async () => {
    expect((await POST(request({}))).status).toBe(400);
  });
});
