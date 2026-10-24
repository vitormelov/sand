import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NewsEvent } from '../../shared/types';
import type { NormalizedArticle } from '../types';
import type { ConnectorState } from '../sources/types';

// node:sqlite is built into Node ≥ 22.13 — no native compilation needed.
const require = createRequire(import.meta.url);
type DB = import('node:sqlite').DatabaseSync;

/**
 * SQLite persistence: articles (dedup), consolidated events, connector state
 * and anonymous feedback counts. Nothing about users is stored here.
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
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_digest TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS user_items (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        item_id TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, kind, item_id)
      );
      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback (
        event_id TEXT NOT NULL,
        value TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (event_id, value)
      );
    `);
  }

  // ------------------------------------------------------------- accounts

  createUser(id: string, email: string, passwordHash: string, nowIso: string): boolean {
    try {
      this.db.prepare(`INSERT INTO users(id, email, password_hash, created_at) VALUES(?,?,?,?)`).run(id, email, passwordHash, nowIso);
      return true;
    } catch {
      return false; // email already registered
    }
  }

  userByEmail(email: string): { id: string; email: string; passwordHash: string } | undefined {
    const r = this.db.prepare(`SELECT id, email, password_hash FROM users WHERE email = ?`).get(email) as { id: string; email: string; password_hash: string } | undefined;
    return r ? { id: r.id, email: r.email, passwordHash: r.password_hash } : undefined;
  }

  userById(id: string): { id: string; email: string; passwordHash: string } | undefined {
    const r = this.db.prepare(`SELECT id, email, password_hash FROM users WHERE id = ?`).get(id) as { id: string; email: string; password_hash: string } | undefined;
    return r ? { id: r.id, email: r.email, passwordHash: r.password_hash } : undefined;
  }

  setPasswordHash(userId: string, hash: string): void {
    this.db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, userId);
  }

  /** Deletes the account and everything attached to it (sessions, answers). */
  deleteUser(userId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
    this.db.prepare(`DELETE FROM profiles WHERE user_id = ?`).run(userId);
    this.db.prepare(`DELETE FROM user_items WHERE user_id = ?`).run(userId);
    this.db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  }

  createSession(digest: string, userId: string, expiresIso: string): void {
    this.db.prepare(`INSERT INTO sessions(token_digest, user_id, expires_at) VALUES(?,?,?)`).run(digest, userId, expiresIso);
  }

  sessionUser(digest: string, nowIso: string): string | undefined {
    const r = this.db.prepare(`SELECT user_id FROM sessions WHERE token_digest = ? AND expires_at > ?`).get(digest, nowIso) as { user_id: string } | undefined;
    return r?.user_id;
  }

  deleteSession(digest: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token_digest = ?`).run(digest);
  }

  deleteSessionsOf(userId: string, exceptDigest?: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_digest != ?`).run(userId, exceptDigest ?? '');
  }

  purgeSessions(nowIso: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(nowIso);
  }

  getProfile(userId: string): unknown {
    const r = this.db.prepare(`SELECT data FROM profiles WHERE user_id = ?`).get(userId) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  }

  setProfile(userId: string, data: unknown, nowIso: string): void {
    this.db
      .prepare(`INSERT INTO profiles(user_id, data, updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .run(userId, JSON.stringify(data), nowIso);
  }

  // --------------------------------------------------- seen / saved news

  addItem(userId: string, kind: 'viewed' | 'saved', itemId: string, data: unknown, nowIso: string): void {
    this.db
      .prepare(`INSERT INTO user_items(user_id, kind, item_id, data, created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id, kind, item_id) DO UPDATE SET data = excluded.data`)
      .run(userId, kind, itemId, data == null ? null : JSON.stringify(data), nowIso);
  }

  removeItem(userId: string, kind: 'viewed' | 'saved', itemId: string): void {
    this.db.prepare(`DELETE FROM user_items WHERE user_id = ? AND kind = ? AND item_id = ?`).run(userId, kind, itemId);
  }

  items(userId: string, kind: 'viewed' | 'saved', limit: number): { id: string; data: unknown; createdAt: string }[] {
    const rows = this.db
      .prepare(`SELECT item_id, data, created_at FROM user_items WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ?`)
      .all(userId, kind, limit) as { item_id: string; data: string | null; created_at: string }[];
    return rows.map((r) => ({ id: r.item_id, data: r.data ? JSON.parse(r.data) : null, createdAt: r.created_at }));
  }

  countItems(userId: string, kind: 'viewed' | 'saved'): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM user_items WHERE user_id = ? AND kind = ?`).get(userId, kind) as { n: number }).n;
  }

  /** "Seen" marks only matter while the news is in the sand. */
  purgeViewed(beforeIso: string): void {
    this.db.prepare(`DELETE FROM user_items WHERE kind = 'viewed' AND created_at < ?`).run(beforeIso);
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
    if (ids.length) {
      const del = this.db.prepare(`DELETE FROM feedback WHERE event_id = ?`);
      for (const id of ids) del.run(id);
    }
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

  addFeedback(eventId: string, value: 'relevant' | 'not_relevant'): void {
    this.db
      .prepare(`INSERT INTO feedback(event_id, value, count) VALUES(?, ?, 1) ON CONFLICT(event_id, value) DO UPDATE SET count = count + 1`)
      .run(eventId, value);
  }

  feedbackCounts(eventId: string): Record<string, number> {
    const rows = this.db.prepare(`SELECT value, count FROM feedback WHERE event_id = ?`).all(eventId) as { value: string; count: number }[];
    return Object.fromEntries(rows.map((r) => [r.value, r.count]));
  }
}
