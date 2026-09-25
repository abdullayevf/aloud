/**
 * A fixed-size ring of recent loudness values.
 *
 * The worklet posts one value per render quantum — roughly 375 a second at
 * 48 kHz. That can never reach React state; at that rate a re-render per value
 * would spend the whole frame budget on reconciliation. So values land here, in
 * a plain object held in a ref, and the canvas reads the whole buffer once per
 * animation frame instead.
 *
 * Unwritten slots read as silence, so a call that has just started draws a flat
 * line rather than whatever the array was allocated over.
 */
export class LevelTrace {
  private readonly buffer: Float32Array;
  private writes = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`LevelTrace capacity must be a positive integer, got ${capacity}`);
    }
    this.buffer = new Float32Array(capacity);
  }

  get capacity(): number {
    return this.buffer.length;
  }

  /** Anything that is not a finite number is treated as silence — one bad
   * frame must not put an unrenderable value into a buffer the canvas reads
   * every frame thereafter.
   *
   * `Number.isFinite`, not `Number.isNaN`: the worklet is a cached file, and a
   * stale one serving the old message shape hands us `undefined` here. That is
   * not NaN, so the old guard let it through, and `Math.min(1, Math.max(0,
   * undefined))` is NaN — the exact value the guard existed to keep out, with
   * the trace silently blank for the rest of the call.
   *
   * `+Infinity` keeps its measured behaviour: it clamps to the meter's ceiling
   * like any other out-of-range level, rather than reading as silence. A level
   * that overflowed is loud, not quiet, and saying otherwise on a screen a
   * deaf user reads for "is someone talking" is the wrong way to be wrong. */
  push(level: number): void {
    const safe = Number.isFinite(level)
      ? Math.min(1, Math.max(0, level))
      : level === Number.POSITIVE_INFINITY
        ? 1
        : 0;
    this.buffer[this.writes % this.buffer.length] = safe;
    this.writes += 1;
  }

  /**
   * Oldest to newest, always `capacity` long.
   *
   * Right-aligned before the buffer has wrapped: the newest value belongs at
   * the right edge from the very first frame, so the trace grows in from the
   * left instead of sliding sideways as the buffer fills.
   */
  read(): Float32Array {
    const { length } = this.buffer;
    const out = new Float32Array(length);
    if (this.writes < length) {
      out.set(this.buffer.subarray(0, this.writes), length - this.writes);
      return out;
    }
    const start = this.writes % length;
    out.set(this.buffer.subarray(start), 0);
    out.set(this.buffer.subarray(0, start), length - start);
    return out;
  }

  clear(): void {
    this.buffer.fill(0);
    this.writes = 0;
  }
}
