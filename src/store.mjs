import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
  const list = db.prepare('SELECT data FROM records WHERE kind=? AND (? IS NULL OR channel_id=?) ORDER BY created_at DESC LIMIT ?');
  const countSince = db.prepare('SELECT COUNT(*) n FROM records WHERE kind=? AND created_at>=?');
  const queuedJob = db.prepare("SELECT id,data FROM records WHERE kind='jobs' AND json_extract(data,'$.status')='queued' AND (? IS NULL OR channel_id=?) ORDER BY created_at ASC LIMIT 1");
  const expiredJobs = db.prepare("SELECT id,data FROM records WHERE kind='jobs' AND json_extract(data,'$.status')='running' AND json_extract(data,'$.lease.expiresAt')<=?");
  const replaceJob = db.prepare("UPDATE records SET data=?,created_at=? WHERE kind='jobs' AND id=?");
  const event = db.prepare('INSERT INTO events(kind,created_at,data) VALUES(?,?,?)');
  const store = {
    put(kind, value, channelId = value.channelId ?? null) { const createdAt = value.createdAt || new Date().toISOString(); ins.run(kind, value.id, channelId, createdAt, JSON.stringify(value)); return value; },
    get(kind, id) { const row = get.get(kind, id); return row ? JSON.parse(row.data) : null; },
    delete(kind, id) { return del.run(kind, id).changes > 0; },
    list(kind, limit = 200, channelId = null) { return list.all(kind, channelId, channelId, Math.min(Math.max(Number(limit) || 200, 1), 500)).map(row => JSON.parse(row.data)); },
    claimNextJob(workerId, leaseMs = 120_000, now = new Date()) {
      const worker = String(workerId || '').trim();
      if (worker.length < 2 || worker.length > 100) throw new Error('workerId must be 2–100 characters.');
      const leaseDuration = Math.max(15_000, Math.min(Number(leaseMs) || 120_000, 10 * 60_000));
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = queuedJob.get(null, null);
        if (!row) { db.exec('COMMIT'); return null; }
        const current = JSON.parse(row.data);
        const claimedAt = now.toISOString();
        const job = { ...current, status: 'running', stage: 'running', startedAt: claimedAt, updatedAt: claimedAt, lease: { id: randomUUID(), workerId: worker, expiresAt: new Date(now.getTime() + leaseDuration).toISOString() } };
        replaceJob.run(JSON.stringify(job), current.createdAt || claimedAt, row.id);
        event.run('job_claimed', claimedAt, JSON.stringify({ jobId: row.id, workerId: worker, leaseExpiresAt: job.lease.expiresAt }));
        db.exec('COMMIT');
        return job;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    recoverExpiredJobs(now = new Date()) {
      const at = now.toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const rows = expiredJobs.all(at);
        const recovered = rows.map(row => {
          const current = JSON.parse(row.data);
          const retries = Number(current.retryCount) || 0;
          const retryCount = retries + 1;
          const exhausted = retryCount > 3;
          const job = { ...current, status: exhausted ? 'failed' : 'queued', stage: exhausted ? 'failed' : 'queued', retryCount: exhausted ? retries : retryCount, failureReason: 'Worker lease expired before completion.', lease: null, updatedAt: at };
          replaceJob.run(JSON.stringify(job), current.createdAt || at, row.id);
          event.run(exhausted ? 'job_lease_expired_final' : 'job_lease_expired_requeued', at, JSON.stringify({ jobId: row.id, retryCount: job.retryCount }));
          return job;
        });
        db.exec('COMMIT');
        return recovered;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    countSince(kind, since) { return Number(countSince.get(kind, since).n); },
    record(kind, value) { event.run(kind, new Date().toISOString(), JSON.stringify(value)); },
    close() { db.close(); }
  };
  if (!store.get('channels', 'default')) store.put('channels', initialChannels[0]);
  return store;
}
