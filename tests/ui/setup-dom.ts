import { vi } from 'vitest';

/** Browser APIs jsdom lacks. The canvas is stubbed: these tests cover the UI, not pixels. */
export function installDomStubs() {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? undefined : () => undefined), set: () => true });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  let raf = 0;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number) as never;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  void raf;
  localStorage.clear();
}

/** Controllable EventSource. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  onopen?: () => void;
  onerror?: () => void;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  fail(closed = false) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.();
  }
  emit(type: string, data: unknown, id?: number) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data), lastEventId: id != null ? String(id) : '' });
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  static latest() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}
