/**
 * Optional, off by default: a barely audible tick when a larger grain lands.
 * Filtered noise, rate-limited, created lazily after a user gesture.
 */
export class GrainSound {
  private ctx?: AudioContext;
  private buffer?: AudioBuffer;
  private lastAt = 0;

  private ensure(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      const len = Math.floor(this.ctx.sampleRate * 0.03);
      this.buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.buffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    } catch {
      return undefined;
    }
    return this.ctx;
  }

  tick(radius: number): void {
    const now = performance.now();
    if (now - this.lastAt < 160) return;
    this.lastAt = now;
    const ctx = this.ensure();
    if (!ctx || !this.buffer || ctx.state !== 'running') {
      void ctx?.resume().catch(() => undefined);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600 - Math.min(9, radius) * 180;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(0.05, 0.012 * radius);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  close(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
  }
}
