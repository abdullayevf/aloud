import { TARGET_SAMPLE_RATE, decodeBase64ToInt16, int16ToFloat } from "./pcm";

export class ReplyPlayer {
  private cursor = 0;
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

    this.cursor = Math.max(this.cursor, this.ctx.currentTime);
    source.start(this.cursor);
    this.cursor += buffer.duration;

    this.scheduled.add(source);
    source.onended = () => this.scheduled.delete(source);
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
  }

  close(): void {
    this.flush();
  }
}
