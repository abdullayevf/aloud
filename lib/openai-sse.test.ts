import { describe, expect, it } from "vitest";
import { buildVerbatimSSE } from "./openai-sse";

function payloads(frames: string[]) {
  return frames
    .filter((f) => !f.includes("[DONE]"))
    .map((f) => JSON.parse(f.replace(/^data: /, "").trim()));
}

describe("buildVerbatimSSE", () => {
  it("terminates the stream with the OpenAI done sentinel", () => {
    const frames = buildVerbatimSSE("hello", "aloud-verbatim", "cmpl-1", 1_700_000_000);
    expect(frames.at(-1)).toBe("data: [DONE]\n\n");
  });

  it("emits every frame as a well-formed SSE data line", () => {
    for (const frame of buildVerbatimSSE("hello", "aloud-verbatim", "cmpl-1", 1)) {
      expect(frame.startsWith("data: ")).toBe(true);
      expect(frame.endsWith("\n\n")).toBe(true);
    }
  });

  it("carries the text through byte for byte across the content frames", () => {
    const text = "Yes — 415 555 0134. Thank you!";
    const joined = payloads(buildVerbatimSSE(text, "m", "id", 1))
      .map((p) => p.choices[0].delta.content ?? "")
      .join("");
    expect(joined).toBe(text);
  });

  it("opens with the assistant role and closes with finish_reason stop", () => {
    const parsed = payloads(buildVerbatimSSE("hi", "m", "id", 1));
    expect(parsed[0].choices[0].delta.role).toBe("assistant");
    expect(parsed.at(-1)!.choices[0].finish_reason).toBe("stop");
  });

  it("still produces a valid, terminated stream for empty text", () => {
    const frames = buildVerbatimSSE("", "m", "id", 1);
    expect(frames.at(-1)).toBe("data: [DONE]\n\n");
    const joined = payloads(frames)
      .map((p) => p.choices[0].delta.content ?? "")
      .join("");
    expect(joined).toBe("");
  });

  it("stamps the model and id the caller asked for", () => {
    const parsed = payloads(buildVerbatimSSE("hi", "aloud-verbatim", "cmpl-9", 42));
    expect(parsed[0].model).toBe("aloud-verbatim");
    expect(parsed[0].id).toBe("cmpl-9");
    expect(parsed[0].created).toBe(42);
  });
});
