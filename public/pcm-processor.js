// Captures mic audio, resamples to 24 kHz, posts PCM16 to the main thread.
// The context is NEVER forced to 24 kHz: Firefox silently loses echo cancellation
// and Safari ignores the option and garbles the audio. We resample here instead.
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { inputSampleRate, targetSampleRate } = options.processorOptions;
    this.ratio = inputSampleRate / targetSampleRate;
    // Fractional source-sample read position, carried across render quanta so
    // resampling stays phase-continuous instead of restarting at 0 every block
    // (that restart silently dropped samples for any non-integer ratio, e.g. 44.1kHz->24kHz).
    this.pos = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    // Root-mean-square of this render quantum: the hearing party's actual
    // loudness, measured rather than inferred. This is the only continuous
    // signal on the screen that is not delayed by transcription.
    let sumSquares = 0;
    for (let i = 0; i < input.length; i += 1) sumSquares += input[i] * input[i];
    const level = Math.sqrt(sumSquares / input.length);

    const out = [];
    while (this.pos < input.length) {
      const sample = input[Math.floor(this.pos)] || 0;
      out.push(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))));
      this.pos += this.ratio;
    }
    this.pos -= input.length;

    const pcm16 = Int16Array.from(out);
    // The PCM buffer is transferred (zero-copy); `level` is a plain number and
    // rides along in the same message so the two never drift apart.
    this.port.postMessage({ pcm: pcm16.buffer, level }, [pcm16.buffer]);
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
