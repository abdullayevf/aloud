import { describe, expect, it, vi } from "vitest";
import { MIN_LEAD_SECONDS, ReplyPlayer } from "./playback";
import { encodeInt16ToBase64 } from "./pcm";

function fakeContext() {
  const started: number[] = [];
  const stopped: unknown[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    createBuffer: (_ch: number, length: number, rate: number) => ({
      length,
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      const node = {
        buffer: null,
        connect: vi.fn(),
        start: (when: number) => started.push(when),
        stop: vi.fn(() => stopped.push(node)),
        onended: null,
      } as unknown as AudioBufferSourceNode;
      return node;
    },
    // AudioContext declares currentTime readonly; these tests advance the
    // clock by hand, so the fake exposes it as writable.
  } as unknown as Omit<AudioContext, "currentTime"> & { currentTime: number };
  return { ctx, started, stopped };
}

const chunk = (samples: number) => encodeInt16ToBase64(new Int16Array(samples));

describe("ReplyPlayer", () => {
  it("schedules chunks back to back, not all at once", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    player.enqueue(chunk(24_000));
    expect(started[0]).toBeCloseTo(MIN_LEAD_SECONDS, 6);
    expect(started[1]).toBeCloseTo(MIN_LEAD_SECONDS + 1, 6);
  });

  it("never schedules in the past once the queue has drained", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = 10;
    player.enqueue(chunk(24_000));
    expect(started[1]).toBeCloseTo(10 + MIN_LEAD_SECONDS, 6);
  });

  it("STOPS already-scheduled sources on flush, not just the cursor", () => {
    const { ctx, stopped } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    player.enqueue(chunk(24_000));
    player.flush();
    expect(stopped).toHaveLength(2);
  });

  it("resumes from now after a flush", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = 0.25;
    player.flush();
    player.enqueue(chunk(24_000));
    expect(started[1]).toBeCloseTo(0.25 + MIN_LEAD_SECONDS, 6);
  });

  it("ignores an empty chunk without scheduling anything", () => {
    const { ctx, started } = fakeContext();
    new ReplyPlayer(ctx).enqueue(encodeInt16ToBase64(new Int16Array(0)));
    expect(started).toEqual([]);
  });

  it("never starts a frame at currentTime — that is the already-rendered past", () => {
    const { ctx, started } = fakeContext();
    ctx.currentTime = 3;
    new ReplyPlayer(ctx).enqueue(chunk(240)); // one 10 ms frame, as the server sends
    expect(started[0]).toBeGreaterThan(3);
  });

  it("does not re-add the lead mid-sentence — gaps stay exactly one buffer", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    for (let i = 0; i < 4; i += 1) player.enqueue(chunk(240)); // 4 x 10 ms
    expect(started[1] - started[0]).toBeCloseTo(0.01, 6);
    expect(started[2] - started[1]).toBeCloseTo(0.01, 6);
    expect(started[3] - started[2]).toBeCloseTo(0.01, 6);
  });

  it("uses twice the browser's reported output latency when that exceeds the floor", () => {
    const { ctx, started } = fakeContext();
    (ctx as unknown as { outputLatency: number }).outputLatency = 0.2; // Bluetooth-ish
    new ReplyPlayer(ctx).enqueue(chunk(240));
    expect(started[0]).toBeCloseTo(0.4, 6);
  });
});
