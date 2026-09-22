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
    // The FIRST transcript.agent of a session is the automatic greeting and is
    // deliberately swallowed (see the test below), so burn it before asserting
    // on a real reply's receipt.
    FakeSocket.last.emit({ type: "transcript.agent", text: "greeting" });
    FakeSocket.last.emit({ type: "transcript.agent", text: "hello", interrupted: true });
    expect(handlers.onSpoken).toHaveBeenCalledWith("hello", true);
  });

  it("swallows the FIRST transcript.agent of a session (the automatic greeting), forwarding only later ones", () => {
    const { c, handlers } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.emit({ type: "session.ready", session_id: "sess_1" });
    FakeSocket.last.emit({ type: "transcript.agent", text: "Hello, you're on a relay call." });
    expect(handlers.onSpoken).not.toHaveBeenCalled();
    FakeSocket.last.emit({ type: "transcript.agent", text: "hello" });
    expect(handlers.onSpoken).toHaveBeenCalledWith("hello", false);
    expect(handlers.onSpoken).toHaveBeenCalledTimes(1);
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

  it("closeAbandoned closes the socket directly, without the session.end handshake", () => {
    const { c } = client();
    void c.connect();
    FakeSocket.last.onopen?.();
    FakeSocket.last.sent.length = 0;
    c.closeAbandoned();
    expect(FakeSocket.last.readyState).toBe(3);
    expect(FakeSocket.last.sent).toEqual([]);
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

  it("forwards post-connect errors instead of swallowing them", async () => {
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
    await promise;

    expect(handlers.onError).not.toHaveBeenCalled();

    // A later, post-connect error on the SAME live socket must now reach the
    // caller's real onError. Before the fix it was permanently swallowed,
    // because the wrapped handler's `settled` flag stayed true forever once
    // the attempt had resolved.
    FakeSocket.last.emit({ type: "session.error", code: "some_later_error", message: "oops" });

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledWith("some_later_error: oops");
  });

  it("closes the abandoned socket from a retried attempt", async () => {
    const handlers = recoveryHandlers();
    const fetchCredentials = vi.fn(async (recreate: boolean) =>
      recreate ? { token: "tok2", agentId: "agent-2" } : { token: "tok1", agentId: "agent-1" },
    );

    const promise = connectWithRecovery(fetchCredentials, handlers, fakePlayer(), {
      SocketImpl: FakeSocket as never,
    });
    promise.catch(() => {});

    await waitFor(() => Boolean(FakeSocket.last));
    const firstSocket = FakeSocket.last;
    firstSocket.onopen?.();
    expect(firstSocket.readyState).toBe(1);
    firstSocket.emit({ type: "session.error", code: "agent_not_found", message: "no such agent" });

    // The abandoned attempt's socket must be closed, not left open (and
    // billing) while the retry proceeds. closeAbandoned() runs inside
    // connectWithRecovery's catch, one microtask after the RetrySignal
    // rejection, hence the poll rather than a bare synchronous assertion.
    await waitFor(() => firstSocket.readyState === 3);
    expect(firstSocket.readyState).toBe(3);

    await waitFor(() => FakeSocket.last !== firstSocket);
    const secondSocket = FakeSocket.last;
    secondSocket.onopen?.();
    secondSocket.emit({ type: "session.ready", session_id: "sess_2" });
    const client = await promise;
    expect(client.sessionId).toBe("sess_2");
  });

  it("times out an attempt that never resolves, closes its socket, and does not retry", async () => {
    vi.useFakeTimers();
    try {
      const handlers = recoveryHandlers();
      const fetchCredentials = vi.fn(async (_recreate: boolean) => ({
        token: "tok1",
        agentId: "agent-1",
      }));

      const promise = connectWithRecovery(fetchCredentials, handlers, fakePlayer(), {
        SocketImpl: FakeSocket as never,
      });
      promise.catch(() => {});

      // Let fetchCredentials's own promise and attemptConnect's synchronous
      // setup run, but never call onopen/emit — the socket just never fires
      // anything, simulating a silent pre-handshake stall (CLAUDE.md: "a
      // pre-handshake failure surfaces only as close code 1006 with nothing
      // readable" — here it doesn't even get that).
      await vi.advanceTimersByTimeAsync(0);
      const socket = FakeSocket.last;
      expect(socket).toBeTruthy();

      await vi.advanceTimersByTimeAsync(10_000);

      await expect(promise).rejects.toThrow("Connection attempt timed out.");
      expect(handlers.onError).toHaveBeenCalledTimes(1);
      expect(handlers.onError).toHaveBeenCalledWith("Connection attempt timed out.");
      expect(fetchCredentials).toHaveBeenCalledTimes(1);
      expect(socket.readyState).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
