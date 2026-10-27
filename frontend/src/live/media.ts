/** Half-duplex audio: no cloud browser speech APIs, no recordings. */
import captureWorkletURL from './pcm-worklet.js?url';
export class InterviewMedia {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private playback: AudioBufferSourceNode | null = null;
  private resolvePlayback: (() => void) | null = null;
  private meterTimer: number | null = null;
  private playVersion = 0;
  private captureVersion = 0;
  private output: GainNode | null = null;
  private outputMuted = false;
  listening = false;

  constructor(private onPCM: (buffer: ArrayBuffer, level: number) => void,
    private onOutputLevel: (level: number) => void) {}

  async prepareAudio() {
    if (!window.AudioContext) throw new Error('Audio playback is unavailable in this browser.');
    if (!this.context) this.context = new AudioContext();
    await this.context.resume();
  }
  async open() {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error('Microphone capture is unavailable. Use localhost or HTTPS and a supported browser.');
    await this.prepareAudio();
    if (this.stream) return;
    const version = ++this.captureVersion;
    let expired = false;
    const request = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1,
      echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    void request.then(lateStream => {
      if (expired || version !== this.captureVersion || !this.context) lateStream.getTracks().forEach(track => track.stop());
    }).catch(() => undefined);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream;
    try {
      stream = await Promise.race([request, new Promise<MediaStream>((_resolve, reject) => {
        deadline = setTimeout(() => { expired = true; reject(new Error('Microphone permission timed out.')); }, 15000);
      })]);
    } finally { clearTimeout(deadline); }
    if (version !== this.captureVersion || !this.context) {
      stream.getTracks().forEach(track => track.stop()); throw new Error('Microphone request cancelled.');
    }
    this.stream = stream;
    try {
      const context = this.context!;
      await context.audioWorklet.addModule(captureWorkletURL);
      this.source = context.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(context, 'pcm-capture');
      this.sink = context.createGain(); this.sink.gain.value = 0;
      this.worklet.port.onmessage = event => {
        if (this.listening) this.onPCM(event.data.buffer, event.data.level);
      };
      this.source.connect(this.worklet); this.worklet.connect(this.sink); this.sink.connect(context.destination);
      this.setListening(false);
    } catch (error) { this.releaseMicrophone(); throw error; }
  }

  setListening(on: boolean) {
    this.listening = on;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = on; });
  }

  async play(bytes: ArrayBuffer) {
    if (!this.context) throw new Error('Join the interview to enable audio playback.');
    this.stopSpeech(); this.setListening(false);
    const version = this.playVersion;
    const context = this.context;
    await context.resume();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    if (version !== this.playVersion || this.context !== context) return;
    const source = context.createBufferSource(), analyser = context.createAnalyser();
    const output = context.createGain(); output.gain.value = this.outputMuted ? 0 : 1; this.output = output;
    analyser.fftSize = 256; source.buffer = buffer; source.connect(analyser); analyser.connect(output); output.connect(context.destination);
    this.playback = source;
    const samples = new Float32Array(analyser.fftSize);
    this.meterTimer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      this.onOutputLevel(Math.min(1, Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length) * 5));
    }, 70);
    return new Promise<void>(resolve => {
      this.resolvePlayback = resolve;
      source.onended = () => {
        source.disconnect(); analyser.disconnect(); output.disconnect();
        if (this.playback === source) { this.playback = null; this.clearMeter(); this.resolvePlayback = null; }
        resolve();
      };
      source.start();
    });
  }
  private clearMeter() { if (this.meterTimer !== null) clearInterval(this.meterTimer); this.meterTimer = null; this.onOutputLevel(0); }
  stopSpeech() {
    this.playVersion++;
    const source = this.playback; this.playback = null;
    if (source) { source.onended = null; try { source.stop(); source.disconnect(); } catch { /* Already ended. */ } }
    this.clearMeter(); this.resolvePlayback?.(); this.resolvePlayback = null;
    this.output?.disconnect(); this.output = null;
  }
  setOutputMuted(value: boolean) { this.outputMuted = value; if (this.output) this.output.gain.value = value ? 0 : 1; }
  releaseMicrophone() {
    this.captureVersion++;
    this.setListening(false); this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.source?.disconnect(); this.worklet?.disconnect(); this.sink?.disconnect();
    if (this.worklet) this.worklet.port.onmessage = null;
    this.source = null; this.worklet = null; this.sink = null;
  }
  dispose() { this.stopSpeech(); this.releaseMicrophone(); void this.context?.close(); this.context = null; }
}
