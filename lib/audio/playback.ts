import { TARGET_SAMPLE_RATE, decodeBase64ToInt16, int16ToFloat } from "./pcm";

/**
 * How far ahead of `currentTime` the first frame of a burst is scheduled.
 *
 * Measured 2026-09-23 (`scripts/probe-audio.mjs`): the server streams 10 ms
 * frames at ~1x real time with as little as 0 ms of margin. A browser has
 * already rendered past `currentTime` by its output latency — typically
 * 20-50 ms, more on Firefox and over Bluetooth — so a frame scheduled at
 * `currentTime` is scheduled into the past. Web Audio starts such a source
 * immediately instead, at the next render quantum, which means the first
 * several frames all start in the SAME quantum, stacked on top of each other
 * and summed. That burst is the garbled first word.
 *
 * 120 ms sits below the ~200 ms gap of ordinary human turn-taking, and an
 * unintelligible first word is the worse defect. The README's
 * time_to_first_audio_ms figure must include this, not just the 28 ms hop.
 */
export const MIN_LEAD_SECONDS = 0.12;

export class ReplyPlayer {
  private cursor = 0;
  /** When this reply's first frame is scheduled to be heard, on the context
   * clock. Null between replies. */
  private replyStart: number | null = null;
  private scheduled = new Set<AudioBufferSourceNode>();

  constructor(private ctx: AudioContext) {}

  /** Takes the `data` field of a reply.audio event — NOT `audio`, that is the input side. */
  enqueue(base64: string): void {
    const floats = int16ToFloat(decodeBase64ToInt16(base64));
    if (floats.length === 0) return;

    // createBuffer at 24 kHz works on every current browser; the context
    // resamples on output, so we never touch the context's own rate.
    const buffer = this.ctx.createBuffer(1, floats.length, TARGET_SAMPLE_RATE);
    buffer.getChannelData(0).set(floats);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    // Math.max means the lead applies at the start of a burst and after a
    // drain or a flush, and costs nothing mid-sentence: once the cursor runs
    // ahead of the clock it already wins.
    this.cursor = Math.max(this.cursor, this.ctx.currentTime + this.leadIn());
    // The first frame of a reply defines its timeline origin. transcript.agent
    // .delta's start_ms values are offsets into this same audio, so the two
    // share an origin and the ~296ms of leading silence needs no correction:
    // nothing inks until the voice actually starts, which is correct.
    if (this.replyStart === null) this.replyStart = this.cursor;
    source.start(this.cursor);
    this.cursor += buffer.duration;

    this.scheduled.add(source);
    source.onended = () => this.scheduled.delete(source);
  }

  /**
   * Milliseconds of this reply's audio the listener has actually heard, or null
   * when no reply is playing.
   *
   * Clamped at zero: the first frame is scheduled a lead-in into the future, and
   * a negative elapsed would ink words before any sound left the speaker.
   */
  elapsedMs(): number | null {
    if (this.replyStart === null) return null;
    return Math.max(0, (this.ctx.currentTime - this.replyStart) * 1000);
  }

  /** Safari does not implement outputLatency, so the floor carries it there. */
  private leadIn(): number {
    const reported = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return Math.max(MIN_LEAD_SECONDS, reported * 2);
  }

  /** Barge-in. Resetting the cursor alone leaves queued audio playing. */
  flush(): void {
    for (const source of this.scheduled) {
      try {
        source.stop();
      } catch {
        // Already ended; stop() throws on a node that never started.
      }
    }
    this.scheduled.clear();
    this.cursor = this.ctx.currentTime;
    // A barged reply must stop inking. The next enqueue opens a new timeline.
    this.replyStart = null;
  }

  close(): void {
    this.flush();
  }
}
