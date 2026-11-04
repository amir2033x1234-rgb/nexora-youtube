import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initialChannels } from './domain.mjs';

export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'nexora.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, channel_id TEXT, created_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE INDEX IF NOT EXISTS records_channel ON records(kind,channel_id,created_at);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);`);
  const ins = db.prepare('INSERT INTO records(kind,id,channel_id,created_at,data) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET channel_id=excluded.channel_id, created_at=excluded.created_at, data=excluded.data');
  const get = db.prepare('SELECT data FROM records WHERE kind=? AND id=?');
  const del = db.prepare('DELETE FROM records WHERE kind=? AND id=?');
  const list = db.prepare('SELECT data FROM records WHERE kind=? ORDER BY created_at DESC LIMIT ?');
  const countSince = db.prepare('SELECT COUNT(*) n FROM records WHERE kind=? AND created_at>=?');
  const event = db.prepare('INSERT INTO events(kind,created_at,data) VALUES(?,?,?)');
  const store = {
    put(kind, value, channelId = value.channelId ?? null) { const createdAt = value.createdAt || new Date().toISOString(); ins.run(kind, value.id, channelId, createdAt, JSON.stringify(value)); return value; },
    get(kind, id) { const row = get.get(kind, id); return row ? JSON.parse(row.data) : null; },
    delete(kind, id) { return del.run(kind, id).changes > 0; },
    list(kind, limit = 200) { return list.all(kind, Math.min(Math.max(Number(limit) || 200, 1), 500)).map(row => JSON.parse(row.data)); },
    countSince(kind, since) { return Number(countSince.get(kind, since).n); },
    record(kind, value) { event.run(kind, new Date().toISOString(), JSON.stringify(value)); },
    close() { db.close(); }
  };
  if (!store.get('channels', 'default')) store.put('channels', initialChannels[0]);
  return store;
}
