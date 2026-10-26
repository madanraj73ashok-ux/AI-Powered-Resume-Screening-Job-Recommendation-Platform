// Local microphone audio only. Downsample to 16 kHz mono signed PCM16.
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.position = 0; this.sum = 0; this.count = 0;
    this.frame = new Int16Array(1024); this.index = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const ratio = sampleRate / 16000;
    for (const value of input) {
      this.sum += value; this.count++; this.position++;
      if (this.position >= ratio) {
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.frame[this.index++] = sample < 0 ? sample * 32768 : sample * 32767;
        this.position -= ratio; this.sum = 0; this.count = 0;
        if (this.index === this.frame.length) {
          let energy = 0;
          for (const s of this.frame) energy += (s / 32768) ** 2;
          const buffer = this.frame.buffer;
          this.port.postMessage({ buffer, level: Math.sqrt(energy / this.frame.length) }, [buffer]);
          this.frame = new Int16Array(1024); this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMProcessor);
