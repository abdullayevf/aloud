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

describe("ReplyPlayer playback clock", () => {
  it("has no clock before anything is scheduled", () => {
    const { ctx } = fakeContext();
    expect(new ReplyPlayer(ctx).elapsedMs()).toBeNull();
  });

  it("reads zero until the scheduled lead-in has actually elapsed", () => {
    // The first buffer starts MIN_LEAD_SECONDS in the future. Until the clock
    // reaches it, no audio has been heard and nothing may be inked.
    const { ctx } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    expect(player.elapsedMs()).toBe(0);
  });

  it("measures from the moment the reply's audio began, not from enqueue", () => {
    const { ctx } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = MIN_LEAD_SECONDS + 0.5;
    expect(player.elapsedMs()).toBeCloseTo(500, 3);
  });

  it("drops the clock on flush so a barged reply cannot keep inking", () => {
    const { ctx } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    ctx.currentTime = MIN_LEAD_SECONDS + 0.5;
    player.flush();
    expect(player.elapsedMs()).toBeNull();
  });

  it("starts a new clock for the reply after a flush", () => {
    const { ctx } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    player.flush();
    ctx.currentTime = 5;
    player.enqueue(chunk(24_000));
    ctx.currentTime = 5 + MIN_LEAD_SECONDS + 0.25;
    expect(player.elapsedMs()).toBeCloseTo(250, 3);
  });

  it("opens a fresh clock for the next reply via beginReply(), with no flush between them", () => {
    // Two replies back to back, no interjection from the hearing party: the
    // real bug this covers. Without beginReply(), reply B's first enqueue()
    // would see replyStart already set from reply A and keep A's origin,
    // while B's start_ms deltas restart at 0 -- every reply after the first
    // in an uninterrupted run would ink against the wrong clock.
    const { ctx } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000)); // reply A's audio
    ctx.currentTime = 10;
    player.beginReply(); // relay-client's cue: reply.started for reply B
    player.enqueue(chunk(24_000)); // reply B's first frame
    ctx.currentTime = 10 + MIN_LEAD_SECONDS + 0.3;
    expect(player.elapsedMs()).toBeCloseTo(300, 3);
  });

  it("does not stop or unschedule audio already queued", () => {
    // reply.started fires well before reply B's audio arrives, while reply
    // A's audio is typically still scheduled into the future. beginReply()
    // must not touch it -- only flush() (barge-in) may stop playing audio.
    const { ctx, stopped } = fakeContext();
    const player = new ReplyPlayer(ctx);
    player.enqueue(chunk(24_000));
    player.enqueue(chunk(24_000));
    player.beginReply();
    expect(stopped).toHaveLength(0);
  });
});
