import { describe, expect, it, vi } from "vitest";
import { ReplyPlayer } from "./playback";
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
    expect(started).toEqual([0, 1]);
  });

  it("never schedules in the past once the queue has drained", () => {
    const { ctx, started } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = 10;
    player.enqueue(chunk(24_000));
    expect(started[1]).toBe(10);
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
    expect(started[1]).toBe(0.25);
  });

  it("ignores an empty chunk without scheduling anything", () => {
    const { ctx, started } = fakeContext();
    new ReplyPlayer(ctx).enqueue(encodeInt16ToBase64(new Int16Array(0)));
    expect(started).toEqual([]);
  });
});
