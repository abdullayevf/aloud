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

    const out = [];
    while (this.pos < input.length) {
      const sample = input[Math.floor(this.pos)] || 0;
      out.push(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))));
      this.pos += this.ratio;
    }
    this.pos -= input.length;

    const pcm16 = Int16Array.from(out);
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
