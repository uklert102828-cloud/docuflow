import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'docuflow.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      access_token TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_outputs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      stored_name TEXT NOT NULL,
      download_name TEXT NOT NULL,
      size INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_session_status ON jobs(session_id, status);
  `);
  const jobColumns = db.prepare('PRAGMA table_info(jobs)').all();
  if (!jobColumns.some((column) => column.name === 'access_token')) {
    db.exec('ALTER TABLE jobs ADD COLUMN access_token TEXT');
  }

  const statements = {
    insertJob: db.prepare('INSERT INTO jobs (id, session_id, kind, status, settings_json, access_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    insertFile: db.prepare('INSERT INTO job_files (id, job_id, original_name, stored_name, size, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    insertOutput: db.prepare('INSERT INTO job_outputs (id, job_id, stored_name, download_name, size) VALUES (?, ?, ?, ?, ?)'),
    getJob: db.prepare('SELECT * FROM jobs WHERE id = ?'),
    getFiles: db.prepare('SELECT * FROM job_files WHERE job_id = ? ORDER BY sort_order'),
    getOutputs: db.prepare('SELECT * FROM job_outputs WHERE job_id = ?'),
    activeJobs: db.prepare("SELECT * FROM jobs WHERE session_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC"),
    activeJobCount: db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE session_id = ? AND status IN ('queued', 'running')"),
    queuedJobs: db.prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at"),
    updateJob: db.prepare('UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?'),
    updateFile: db.prepare('UPDATE job_files SET status = ?, error = ? WHERE id = ?'),
    resetRunning: db.prepare("UPDATE jobs SET status = 'queued', error = NULL, updated_at = ? WHERE status = 'running'"),
    resetRunningFiles: db.prepare("UPDATE job_files SET status = 'queued', error = NULL WHERE status = 'running'"),
    finishedBefore: db.prepare("SELECT id FROM jobs WHERE status NOT IN ('queued', 'running') AND created_at < ?"),
    deleteJob: db.prepare('DELETE FROM jobs WHERE id = ?'),
  };

  function hydrate(row) {
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      error: row.error,
      settings: JSON.parse(row.settings_json || '{}'),
      accessToken: row.access_token,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      files: statements.getFiles.all(row.id).map((file) => ({
        id: file.id,
        name: file.original_name,
        size: file.size,
        status: file.status,
        error: file.error,
      })),
      outputs: statements.getOutputs.all(row.id).map((output) => ({
        id: output.id,
        name: output.download_name,
        size: output.size,
      })),
    };
  }

  return { db, statements, hydrate };
}
