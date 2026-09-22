import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { encodeOutbound } from "@/lib/sentinel";

function request(messages: unknown[], secret = "test-secret") {
  return new Request("https://example.com/api/llm/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "aloud-verbatim", stream: true, messages }),
  });
}

async function body(res: Response) {
  return await new Response(res.body).text();
}

beforeEach(() => {
  process.env.ALOUD_LLM_SHARED_SECRET = "test-secret";
});

describe("POST /api/llm/v1/chat/completions", () => {
  it("rejects a caller without the shared secret", async () => {
    const res = await POST(request([], "wrong"));
    expect(res.status).toBe(401);
  });

  it("accepts the key on x-api-key too, which is the other header the agent may use", async () => {
    const res = await POST(
      new Request("https://example.com/api/llm/v1/chat/completions", {
        method: "POST",
        headers: { "x-api-key": "test-secret", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "aloud-verbatim",
          stream: true,
          messages: [{ role: "user", content: encodeOutbound("verbatim", "hello") }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await body(res)).toContain(JSON.stringify("hello"));
  });

  it("reads content that arrives as an array of parts, not just a string", async () => {
    const res = await POST(
      request([{ role: "user", content: [{ text: encodeOutbound("verbatim", "parts form") }] }]),
    );
    expect(await body(res)).toContain(JSON.stringify("parts form"));
  });

  it("streams the typed text back byte for byte", async () => {
    const res = await POST(
      request([{ role: "user", content: encodeOutbound("verbatim", "I'd like to reschedule.") }]),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await body(res)).toContain(JSON.stringify("I'd like to reschedule."));
  });

  it("uses the LAST sentinel message, not the first", async () => {
    const res = await POST(
      request([
        { role: "user", content: encodeOutbound("verbatim", "first") },
        { role: "assistant", content: "first" },
        { role: "user", content: "the front desk said something" },
        { role: "user", content: encodeOutbound("verbatim", "second") },
      ]),
    );
    const text = await body(res);
    expect(text).toContain(JSON.stringify("second"));
    expect(text).not.toContain(JSON.stringify("first"));
  });

  it("stays silent when the hearing party speaks and nothing is pending", async () => {
    const res = await POST(request([{ role: "user", content: "hello, front desk" }]));
    const text = await body(res);
    expect(text).toContain("[DONE]");
    expect(text).not.toMatch(/"content":"[^"]+"/);
  });

  it("does not re-speak an utterance that has already been spoken", async () => {
    const res = await POST(
      request([
        { role: "user", content: encodeOutbound("verbatim", "already said") },
        { role: "assistant", content: "already said" },
        { role: "user", content: "and then they replied" },
      ]),
    );
    expect(await body(res)).not.toMatch(/"content":"[^"]+"/);
  });

  it("stays silent instead of throwing on a malformed or absent body", async () => {
    const malformed = new Request("https://example.com/api/llm/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(malformed);
    expect(res.status).toBe(200);
    const text = await body(res);
    expect(text).toContain("[DONE]");
    expect(text).not.toMatch(/"content":"[^"]+"/);
  });

  it("stays silent instead of throwing when the body is literal null", async () => {
    const nullBody = new Request("https://example.com/api/llm/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
      body: "null",
    });
    const res = await POST(nullBody);
    expect(res.status).toBe(200);
    const text = await body(res);
    expect(text).toContain("[DONE]");
    expect(text).not.toMatch(/"content":"[^"]+"/);
  });
});
