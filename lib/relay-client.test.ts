import { describe, expect, it, vi } from "vitest";
import { RelayClient } from "./relay-client";

class FakeSocket {
  static last: FakeSocket;
  sent: string[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function client() {
  const handlers = {
    onCaption: vi.fn(),
    onCaptionFinal: vi.fn(),
    onSpoken: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
  };
  const audio = { enqueue: vi.fn(), flush: vi.fn(), close: vi.fn() };
  const c = new RelayClient(
    { token: "tok", agentId: "agent-1" },
    handlers,
    audio as never,
    FakeSocket as never,
  );
  return { c, handlers, audio };
}

describe("RelayClient", () => {
  it("sends agent_id ALONE as the first config message", async () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    expect(JSON.parse(FakeSocket.last.sent[0])).toEqual({
      type: "session.update",
      session: { agent_id: "agent-1" },
    });
  });

  it("replaces, never concatenates, the partial caption", () => {
    const { c, handlers } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "transcript.user.delta", text: "I can" });
    FakeSocket.last.emit({ type: "transcript.user.delta", text: "I can help with that" });
    expect(handlers.onCaption).toHaveBeenLastCalledWith("I can help with that");
  });

  it("sends the typed text as one-shot instructions on reply.create", () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "session.ready", session_id: "sess_1" });
    FakeSocket.last.sent.length = 0;
    c.say("hello", "verbatim");
    const sent = FakeSocket.last.sent.map((s) => JSON.parse(s));
    expect(sent).toEqual([
      { type: "reply.create", instructions: "\u0001SAY\u0001hello\u0001END\u0001" },
    ]);
  });

  it("flushes playback when the hearing party starts speaking", () => {
    const { c, audio } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "input.speech.started" });
    expect(audio.flush).toHaveBeenCalled();
  });

  it("plays reply.audio from `data`, not `audio`", () => {
    const { c, audio } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "reply.audio", data: "AAAA" });
    expect(audio.enqueue).toHaveBeenCalledWith("AAAA");
  });

  it("reports the spoken receipt with its interrupted flag", () => {
    const { c, handlers } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "transcript.agent", text: "hello", interrupted: true });
    expect(handlers.onSpoken).toHaveBeenCalledWith("hello", true);
  });

  it("drops microphone audio until session.ready, because early audio is discarded", () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.sent.length = 0;
    c.sendAudio("AAAA");
    expect(FakeSocket.last.sent).toEqual([]);
  });

  it("streams microphone audio in `audio`, not `data`, once ready", () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "session.ready", session_id: "sess_1" });
    FakeSocket.last.sent.length = 0;
    c.sendAudio("AAAA");
    expect(JSON.parse(FakeSocket.last.sent[0])).toEqual({ type: "input.audio", audio: "AAAA" });
  });

  it("ends with session.end and waits for session.ended before closing", async () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "session.ready", session_id: "sess_1" });
    const ending = c.hangUp();
    expect(JSON.parse(FakeSocket.last.sent.at(-1)!)).toEqual({ type: "session.end" });
    FakeSocket.last.emit({ type: "session.ended", session_duration_seconds: 12 });
    await ending;
    expect(FakeSocket.last.readyState).toBe(3);
    expect(c.sessionId).toBe("sess_1");
  });
});
