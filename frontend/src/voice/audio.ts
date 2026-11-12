// Low-latency audio for the realtime API: 24 kHz mono PCM16 in both directions.

export const SAMPLE_RATE = 24000;

// AudioWorklet: runs off the main thread. Resamples the mic (usually 44.1/48 kHz) to 24 kHz,
// converts to PCM16 and posts ~40 ms chunks, plus an RMS level for the orb.
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.targetRate;
    this.chunk = Math.round(options.processorOptions.targetRate * 0.04);
    this.buf = new Int16Array(this.chunk);
    this.len = 0;
    this.pos = 0;
    this.sum = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
      this.sum += s * s;
      this.buf[this.len++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.len === this.chunk) {
        this.port.postMessage({ pcm: this.buf.buffer, rms: Math.sqrt(this.sum / this.chunk) }, [this.buf.buffer]);
        this.buf = new Int16Array(this.chunk);
        this.len = 0;
        this.sum = 0;
      }
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor("capture", Capture);
`;

export function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToFloat32(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

export class Mic {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  muted = false;

  async start(onChunk: (base64: string) => void, onLevel: (rms: number) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.node = new AudioWorkletNode(this.ctx, "capture", { processorOptions: { targetRate: SAMPLE_RATE } });
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      if (this.muted) return onLevel(0);
      onChunk(bytesToBase64(e.data.pcm));
      onLevel(e.data.rms);
    };
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    void this.ctx?.close();
  }
}

/** Gapless streaming playback. Tracks how much of the current item was actually heard (for barge-in truncation). */
export class Player {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private itemId: string | null = null;
  private itemStart = 0; // ctx time when the current item started playing
  onIdle?: () => void;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.ctx.destination);
  }

  /** Must be called from a user gesture on iOS Safari to unlock audio. */
  async unlock(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const b = this.ctx.createBuffer(1, 1, SAMPLE_RATE);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.ctx.destination);
    s.start();
  }

  play(itemId: string, base64: string): void {
    const samples = base64ToFloat32(base64);
    if (!samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);
    const now = this.ctx.currentTime;
    const startAt = Math.max(now + 0.02, this.nextTime);
    if (this.itemId !== itemId) {
      this.itemId = itemId;
      this.itemStart = startAt;
    }
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (this.sources.size === 0) this.onIdle?.();
    };
  }

  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  /** Stop immediately. Returns the item that was playing and how many ms of it were heard. */
  interrupt(): { itemId: string; playedMs: number } | null {
    if (!this.itemId || this.sources.size === 0) return null;
    const playedMs = Math.max(0, Math.round((this.ctx.currentTime - this.itemStart) * 1000));
    const res = { itemId: this.itemId, playedMs };
    this.sources.forEach((s) => {
      s.onended = null;
      s.stop();
    });
    this.sources.clear();
    this.nextTime = 0;
    this.itemId = null;
    this.onIdle?.();
    return res;
  }

  level(): number {
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    return Math.sqrt(sum / data.length);
  }

  close(): void {
    this.interrupt();
    void this.ctx.close();
  }
}
