import { describe, expect, it, vi } from "vitest";
import { RelayClient, connectWithRecovery } from "./relay-client";

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

function recoveryHandlers() {
  return {
    onCaption: vi.fn(),
    onCaptionFinal: vi.fn(),
    onSpoken: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
  };
}

function fakePlayer() {
  return { enqueue: vi.fn(), flush: vi.fn(), close: vi.fn() } as never;
}

/**
 * Polls a condition across microtask ticks. connectWithRecovery's retry path
 * does `await fetchCredentials(...)` (itself an async mock) before the next
 * attemptConnect runs, so more than one `await Promise.resolve()` is needed
 * after emitting an error before the *next* FakeSocket.last reflects the
 * retry's new socket. Polling avoids hard-coding a tick count that would be
 * fragile to reorder.
 */
async function waitFor(predicate: () => boolean, maxTicks = 20): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`waitFor: condition not met after ${maxTicks} ticks`);
}

describe("connectWithRecovery", () => {
  it("connects on the first attempt without retrying", async () => {
    const handlers = recoveryHandlers();
    const fetchCredentials = vi.fn(async (_recreate: boolean) => ({
      token: "tok1",
      agentId: "agent-1",
    }));

    const promise = connectWithRecovery(fetchCredentials, handlers, fakePlayer(), {
      SocketImpl: FakeSocket as never,
    });

    await waitFor(() => Boolean(FakeSocket.last));
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "session.ready", session_id: "sess_1" });

    const client = await promise;

    expect(fetchCredentials).toHaveBeenCalledTimes(1);
    expect(fetchCredentials).toHaveBeenCalledWith(false);
    expect(client.sessionId).toBe("sess_1");
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("retries with recreate:true on agent_not_found and connects with the second set of credentials", async () => {
    const handlers = recoveryHandlers();
    const fetchCredentials = vi.fn(async (recreate: boolean) =>
      recreate ? { token: "tok2", agentId: "agent-2" } : { token: "tok1", agentId: "agent-1" },
    );

    const promise = connectWithRecovery(fetchCredentials, handlers, fakePlayer(), {
      SocketImpl: FakeSocket as never,
    });

    await waitFor(() => Boolean(FakeSocket.last));
    const firstSocket = FakeSocket.last;
    firstSocket.onopen?.();
    firstSocket.emit({ type: "session.error", code: "agent_not_found", message: "no such agent" });

    // See waitFor's doc comment: the retry re-fetches credentials (async)
    // before reconnecting, so this needs multiple ticks, not one.
    await waitFor(() => FakeSocket.last !== firstSocket);
    const secondSocket = FakeSocket.last;
    expect(secondSocket).not.toBe(firstSocket);

    secondSocket.onopen?.();
    secondSocket.emit({ type: "session.ready", session_id: "sess_2" });

    const client = await promise;

    expect(fetchCredentials).toHaveBeenCalledTimes(2);
    expect(fetchCredentials).toHaveBeenNthCalledWith(1, false);
    expect(fetchCredentials).toHaveBeenNthCalledWith(2, true);
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(client.sessionId).toBe("sess_2");
  });

  it("gives up after maxAttempts and rejects, having surfaced the final error via onError exactly once", async () => {
    const handlers = recoveryHandlers();
    const fetchCredentials = vi.fn(async (recreate: boolean) => ({
      token: recreate ? "tok2" : "tok1",
      agentId: recreate ? "agent-2" : "agent-1",
    }));

    const promise = connectWithRecovery(fetchCredentials, handlers, fakePlayer(), {
      maxAttempts: 2,
      SocketImpl: FakeSocket as never,
    });
    // Swallow the rejection's default unhandled-rejection reporting until we
    // explicitly assert on it below.
    promise.catch(() => {});

    await waitFor(() => Boolean(FakeSocket.last));
    const firstSocket = FakeSocket.last;
    firstSocket.onopen?.();
    firstSocket.emit({ type: "session.error", code: "agent_not_found", message: "no such agent" });

    await waitFor(() => FakeSocket.last !== firstSocket);
    const secondSocket = FakeSocket.last;
    expect(secondSocket).not.toBe(firstSocket);
    secondSocket.onopen?.();
    secondSocket.emit({ type: "session.error", code: "agent_not_found", message: "no such agent" });

    await expect(promise).rejects.toThrow("agent_not_found: no such agent");

    expect(fetchCredentials).toHaveBeenCalledTimes(2);
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledWith("agent_not_found: no such agent");
  });

  it("does not retry on an unrelated session.error", async () => {
    const handlers = recoveryHandlers();
    const fetchCredentials = vi.fn(async (_recreate: boolean) => ({
      token: "tok1",
      agentId: "agent-1",
    }));

    const promise = connectWithRecovery(fetchCredentials, handlers, fakePlayer(), {
      SocketImpl: FakeSocket as never,
    });
    promise.catch(() => {});

    await waitFor(() => Boolean(FakeSocket.last));
    const firstSocket = FakeSocket.last;
    firstSocket.onopen?.();
    firstSocket.emit({ type: "session.error", code: "invalid_value", message: "bad request" });

    await expect(promise).rejects.toThrow("invalid_value: bad request");

    expect(fetchCredentials).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledWith("invalid_value: bad request");
  });
});
