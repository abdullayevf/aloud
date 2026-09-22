import { describe, expect, it } from "vitest";
import {
  decodeBase64ToInt16,
  encodeInt16ToBase64,
  floatToInt16,
  int16ToFloat,
  resampleRatio,
} from "./pcm";

describe("pcm", () => {
  it("clips instead of wrapping at the rails", () => {
    expect(Array.from(floatToInt16(new Float32Array([1.5, -1.5, 0])))).toEqual([32767, -32768, 0]);
  });

  it("round-trips through base64 unchanged", () => {
    const input = new Int16Array([0, 1, -1, 32767, -32768, 12345]);
    expect(Array.from(decodeBase64ToInt16(encodeInt16ToBase64(input)))).toEqual(Array.from(input));
  });

  it("survives a buffer larger than the argument-spread limit", () => {
    // String.fromCharCode(...bytes) blows the call stack past ~100k arguments.
    const input = new Int16Array(200_000).map((_, i) => (i % 2000) - 1000);
    expect(decodeBase64ToInt16(encodeInt16ToBase64(input)).length).toBe(200_000);
  });

  it("maps int16 back into the float range", () => {
    expect(int16ToFloat(new Int16Array([32767]))[0]).toBeCloseTo(1, 3);
    expect(int16ToFloat(new Int16Array([-32768]))[0]).toBeCloseTo(-1, 3);
  });

  it("computes the resample ratio for the rates browsers actually use", () => {
    expect(resampleRatio(48000, 24000)).toBe(2);
    expect(resampleRatio(44100, 24000)).toBeCloseTo(1.8375, 4);
    expect(resampleRatio(24000, 24000)).toBe(1);
  });
});
