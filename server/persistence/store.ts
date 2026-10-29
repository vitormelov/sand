import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NewsEvent } from '../../shared/types';
import type { NormalizedArticle } from '../types';
import type { ConnectorState } from '../sources/types';

export type ArticleRow = [id: string, eventId: string, sourceId: string, revision: string | null, fetchedAt: string];

// node:sqlite is built into Node ≥ 22.13 — no native compilation needed.
const require = createRequire(import.meta.url);
type DB = import('node:sqlite').DatabaseSync;

/**
 * SQLite persistence: articles (dedup), consolidated events and connector state.
 * The ingestion job runs it in memory, restored from Firestore on every pass.
 */
export class Store {
  private db: DB;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        canonical_url TEXT NOT NULL UNIQUE,
        event_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        revision TEXT,
        fetched_at TEXT NOT NULL,
        title TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS articles_fetched ON articles(fetched_at);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_seq ON events(seq);
      CREATE INDEX IF NOT EXISTS events_expires ON events(expires_at);
      CREATE TABLE IF NOT EXISTS source_state (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
  }

  close(): void {
    this.db.close();
  }

  nextSeq(): number {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'seq'`).get() as { value: string } | undefined;
    const next = (row ? Number(row.value) : 0) + 1;
    this.db.prepare(`INSERT INTO meta(key, value) VALUES('seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(next));
    return next;
  }

  currentSeq(): number {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'seq'`).get() as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }

  /** Restore the stream sequence saved by a previous run-once pass. */
  setSeq(seq: number): void {
    this.db.prepare(`INSERT INTO meta(key, value) VALUES('seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(seq));
  }

  /** Article fingerprints (dedup index) as compact rows: [id, eventId, sourceId, revision, fetchedAt]. */
  exportArticles(): ArticleRow[] {
    const rows = this.db.prepare(`SELECT id, event_id, source_id, revision, fetched_at FROM articles ORDER BY fetched_at`).all() as {
      id: string;
      event_id: string;
      source_id: string;
      revision: string | null;
      fetched_at: string;
    }[];
    return rows.map((r) => [r.id, r.event_id, r.source_id, r.revision, r.fetched_at]);
  }

  importArticles(rows: ArticleRow[]): void {
    // The canonical URL and title are not kept between passes: the id is derived from the URL,
    // so it stands in for it (the column only needs to be unique).
    const ins = this.db.prepare(
      `INSERT INTO articles(id, canonical_url, event_id, source_id, revision, fetched_at, title) VALUES(?,?,?,?,?,?,'') ON CONFLICT(id) DO NOTHING`,
    );
    for (const [id, eventId, sourceId, revision, fetchedAt] of rows) ins.run(id, `id:${id}`, eventId, sourceId, revision, fetchedAt);
  }

  getArticle(id: string): { eventId: string; revision: string | null } | undefined {
    const row = this.db.prepare(`SELECT event_id, revision FROM articles WHERE id = ?`).get(id) as { event_id: string; revision: string | null } | undefined;
    return row ? { eventId: row.event_id, revision: row.revision } : undefined;
  }

  putArticle(a: NormalizedArticle, eventId: string): void {
    this.db
      .prepare(
        `INSERT INTO articles(id, canonical_url, event_id, source_id, revision, fetched_at, title) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, fetched_at = excluded.fetched_at`,
      )
      .run(a.id, a.canonicalUrl, eventId, a.sourceId, a.hints.revision ?? null, a.fetchedAt, a.title);
  }

  putEvent(e: NewsEvent): void {
    this.db
      .prepare(
        `INSERT INTO events(id, seq, first_seen_at, expires_at, data) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, expires_at = excluded.expires_at, data = excluded.data`,
      )
      .run(e.id, e.seq, e.firstSeenAt, e.expiresAt, JSON.stringify(e));
  }

  getEvent(id: string): NewsEvent | undefined {
    const row = this.db.prepare(`SELECT data FROM events WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as NewsEvent) : undefined;
  }

  /** Most recent live events, newest first. */
  recentEvents(limit: number, nowIso = new Date().toISOString()): NewsEvent[] {
    const rows = this.db
      .prepare(`SELECT data FROM events WHERE expires_at > ? ORDER BY first_seen_at DESC LIMIT ?`)
      .all(nowIso, limit) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as NewsEvent);
  }

  /** Events changed after a stream sequence (for SSE resume), oldest first. */
  eventsAfterSeq(seq: number, limit: number, nowIso = new Date().toISOString()): NewsEvent[] {
    const rows = this.db
      .prepare(`SELECT data FROM events WHERE seq > ? AND expires_at > ? ORDER BY seq ASC LIMIT ?`)
      .all(seq, nowIso, limit) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as NewsEvent);
  }

  countEvents(nowIso = new Date().toISOString()): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE expires_at > ?`).get(nowIso) as { n: number }).n;
  }

  /** Retention: drop expired events and old article fingerprints. */
  purge(nowIso: string, articleCutoffIso: string): string[] {
    const ids = (this.db.prepare(`SELECT id FROM events WHERE expires_at <= ?`).all(nowIso) as { id: string }[]).map((r) => r.id);
    this.db.prepare(`DELETE FROM events WHERE expires_at <= ?`).run(nowIso);
    this.db.prepare(`DELETE FROM articles WHERE fetched_at < ?`).run(articleCutoffIso);
    return ids;
  }

  getSourceState(id: string): ConnectorState {
    const row = this.db.prepare(`SELECT data FROM source_state WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as ConnectorState) : {};
  }

  setSourceState(id: string, state: ConnectorState): void {
    this.db
      .prepare(`INSERT INTO source_state(id, data) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(id, JSON.stringify(state));
  }

}
