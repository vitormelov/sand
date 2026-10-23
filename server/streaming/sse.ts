import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NewsEvent, StreamEventMessage, StreamStatus } from '../../shared/types';

interface Client {
  id: number;
  ip: string;
  res: ServerResponse;
}

/**
 * Server-Sent Events hub. One-way delivery fits SAND: the browser only listens.
 *
 * Messages:
 *  - `snapshot` {events, status}           first message on a fresh connection
 *  - `event`    StreamEventMessage          id = event seq (enables Last-Event-ID resume)
 *  - `status`   StreamStatus                source health, throttled
 *  - `expire`   {ids}                       retention removed these events
 * A comment line every 25 s keeps proxies from closing idle connections.
 */
export class SseHub {
  private clients = new Map<number, Client>();
  private nextId = 1;
  private heartbeat: NodeJS.Timeout;

  constructor(private limits: { max: number; perIp: number }) {
    this.heartbeat = setInterval(() => this.broadcastRaw(`: keep-alive ${Date.now()}\n\n`), 25_000);
    this.heartbeat.unref?.();
  }

  get size(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.clients.values()) c.res.end();
    this.clients.clear();
  }

  /** Returns false (and answers 429/503) when limits are exceeded. */
  open(
    req: IncomingMessage,
    res: ServerResponse,
    ip: string,
    initial: { resumeFrom?: number; snapshot: () => { events: NewsEvent[]; status: StreamStatus; seq: number }; since: (seq: number) => NewsEvent[] },
  ): boolean {
    if (this.clients.size >= this.limits.max) {
      res.writeHead(503, { 'Retry-After': '30' }).end('stream capacity reached');
      return false;
    }
    const fromIp = [...this.clients.values()].filter((c) => c.ip === ip).length;
    if (fromIp >= this.limits.perIp) {
      res.writeHead(429, { 'Retry-After': '30' }).end('too many streams from this address');
      return false;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const client: Client = { id: this.nextId++, ip, res };
    this.clients.set(client.id, client);
    const drop = () => this.clients.delete(client.id);
    req.on('close', drop);
    res.on('error', drop);

    const snap = initial.snapshot();
    if (initial.resumeFrom != null && initial.resumeFrom > 0 && initial.resumeFrom <= snap.seq) {
      // Resume: replay only what changed while disconnected.
      for (const e of initial.since(initial.resumeFrom)) this.write(client, 'event', { change: 'update', event: e } satisfies StreamEventMessage, e.seq);
      this.write(client, 'status', snap.status);
    } else {
      this.write(client, 'snapshot', { events: snap.events, status: snap.status }, snap.seq);
    }
    return true;
  }

  sendEvent(msg: StreamEventMessage): void {
    for (const c of this.clients.values()) this.write(c, 'event', msg, msg.event.seq);
  }

  sendStatus(status: StreamStatus): void {
    for (const c of this.clients.values()) this.write(c, 'status', status);
  }

  sendExpire(ids: string[]): void {
    if (ids.length) for (const c of this.clients.values()) this.write(c, 'expire', { ids });
  }

  private write(c: Client, type: string, data: unknown, id?: number): void {
    const payload = `${id != null ? `id: ${id}\n` : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    try {
      c.res.write(payload);
    } catch {
      this.clients.delete(c.id);
    }
  }

  private broadcastRaw(s: string): void {
    for (const c of this.clients.values()) {
      try {
        c.res.write(s);
      } catch {
        this.clients.delete(c.id);
      }
    }
  }
}
