import { describe, expect, it } from "vitest";
import { LevelTrace } from "./level-trace";

describe("LevelTrace", () => {
  it("reads back oldest-to-newest, zero-filled before it wraps", () => {
    // Eighths, not tenths: read() returns a Float32Array (see level-trace.ts),
    // and 0.1 has no exact float32 representation — it would round-trip as
    // 0.10000000149011612 and fail this exact-equality check for a reason
    // that has nothing to do with the ordering/padding behavior under test.
    const trace = new LevelTrace(4);
    trace.push(0.25);
    trace.push(0.5);
    expect(Array.from(trace.read())).toEqual([0, 0, 0.25, 0.5]);
  });

  it("keeps only the newest `capacity` values once it wraps", () => {
    // Values stay inside 0..1 on purpose: push() clamps to that range (see
    // the "clamps to the 0..1 range" case below), so anything at or above 1
    // would collapse to the same clamped value and this test would no longer
    // be exercising wrap/retention — it would be re-testing the clamp.
    const trace = new LevelTrace(3);
    for (const v of [0.125, 0.25, 0.375, 0.5, 0.625]) trace.push(v);
    expect(Array.from(trace.read())).toEqual([0.375, 0.5, 0.625]);
  });

  it("clears back to silence so a new call does not inherit the last one's trace", () => {
    const trace = new LevelTrace(3);
    trace.push(0.9);
    trace.clear();
    expect(Array.from(trace.read())).toEqual([0, 0, 0]);
  });

  it("clamps to the 0..1 range a level meter can render", () => {
    const trace = new LevelTrace(2);
    trace.push(-0.5);
    trace.push(3);
    expect(Array.from(trace.read())).toEqual([0, 1]);
  });

  it("treats a non-finite level as silence rather than poisoning the buffer", () => {
    const trace = new LevelTrace(2);
    trace.push(Number.NaN);
    trace.push(Number.POSITIVE_INFINITY);
    expect(Array.from(trace.read())).toEqual([0, 1]);
  });

  it("treats a missing level as silence — Number.isNaN never caught undefined", () => {
    // A stale cached worklet serving the old message shape posts a frame with
    // no level on it, so `undefined` arrives here. It is not NaN, so the old
    // guard let it through, and Math.min(1, Math.max(0, undefined)) is NaN —
    // the exact value the guard existed to keep out, with the trace silently
    // blank for the rest of the call.
    const trace = new LevelTrace(2);
    trace.push(undefined as unknown as number);
    trace.push(0.5);
    const out = Array.from(trace.read());
    expect(out.some(Number.isNaN)).toBe(false);
    expect(out).toEqual([0, 0.5]);
  });
});
