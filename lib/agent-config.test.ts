// lib/agent-config.test.ts
import { describe, expect, it } from "vitest";
import { buildAgentPayload } from "./agent-config";

const payload = () => buildAgentPayload("https://aloud.example", "s3cret") as any;

describe("buildAgentPayload", () => {
  it("points the custom llm at our own public https endpoint", () => {
    expect(payload().llm).toHaveLength(1);
    expect(payload().llm[0].api_key).toBe("s3cret");
  });

  it("ends base_url in /v1, because the agent appends /chat/completions to it", () => {
    // Our route lives at app/api/llm/v1/chat/completions. If base_url omits the
    // /v1 the agent POSTs to /api/llm/chat/completions and gets a 404, which
    // presents as the agent simply never speaking.
    expect(payload().llm[0].base_url).toBe("https://aloud.example/api/llm/v1");
    expect(`${payload().llm[0].base_url}/chat/completions`).toBe(
      "https://aloud.example/api/llm/v1/chat/completions",
    );
  });

  it("refuses a non-https or loopback origin, which the API rejects anyway", () => {
    expect(() => buildAgentPayload("http://localhost:3000", "s")).toThrow(/https/i);
  });

  it("strips a trailing slash so base_url has no double slash", () => {
    const trailing = buildAgentPayload("https://aloud.example/", "s3cret") as any;
    expect(trailing.llm[0].base_url).toBe("https://aloud.example/api/llm/v1");
    expect(trailing.llm[0].base_url).not.toContain("//api");
  });

  it("uses a voice id from the verified list", () => {
    expect(["alba", "eve", "george", "jane", "jean", "mary", "michael"]).toContain(
      payload().voice.voice_id,
    );
  });

  it("declares no tools — Aloud drives its UI from transcripts, not tool calls", () => {
    expect(payload().tools).toEqual([]);
  });

  it("omits language_codes so the hearing party is understood in any of the 18", () => {
    expect(payload().input.language_codes).toBeUndefined();
  });

  it("omits turn_detection so adaptive pacing survives", () => {
    expect(payload().input.turn_detection).toBeUndefined();
  });

  it("greets with a spoken relay announcement, not an instruction to the model", () => {
    // greeting goes straight to TTS: a meta-instruction would be read aloud.
    expect(payload().greeting).toMatch(/relay call/i);
    expect(payload().greeting).not.toMatch(/^(greet|say|tell) /i);
  });
});
