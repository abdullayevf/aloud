import { TARGET_SAMPLE_RATE, encodeInt16ToBase64 } from "./pcm";

export class MicCapture {
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;

  constructor(private ctx: AudioContext) {}

  async start(onChunk: (base64: string) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      // echoCancellation ON: without it the mic hears our own TTS through the
      // speakers and the hearing party's captions fill with our words.
      // noiseSuppression OFF: the server already denoises, and a second layer
      // costs more accuracy than the noise did.
      audio: { echoCancellation: true, noiseSuppression: false },
    });

    await this.ctx.audioWorklet.addModule("/pcm-processor.js");

    this.node = new AudioWorkletNode(this.ctx, "pcm-processor", {
      processorOptions: {
        inputSampleRate: this.ctx.sampleRate,
        targetSampleRate: TARGET_SAMPLE_RATE,
      },
    });
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      onChunk(encodeInt16ToBase64(new Int16Array(event.data)));
    };

    this.source = this.ctx.createMediaStreamSource(this.stream);
    // Terminate at the worklet. Connecting through to ctx.destination would
    // play the room back into the room.
    this.source.connect(this.node);
  }

  stop(): void {
    this.node?.port.close();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.node = undefined;
    this.source = undefined;
  }
}
