import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDatabase } from '../server/database.js';

test('database stores and hydrates a conversion job', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'docuflow-db-'));
  const database = createDatabase(temp);
  t.after(async () => {
    database.db.close();
    await fs.rm(temp, { recursive: true, force: true });
  });
  const id = crypto.randomUUID();
  const now = Date.now();
  database.statements.insertJob.run(id, 'session', 'pdf-to-word', 'queued', '{}', 'download-token', now, now);
  database.statements.insertFile.run(crypto.randomUUID(), id, '示例.pdf', 'input.pdf', 2048, 'queued', 0);
  const job = database.hydrate(database.statements.getJob.get(id));
  assert.equal(job.kind, 'pdf-to-word');
  assert.equal(job.files[0].name, '示例.pdf');
  assert.equal(job.files[0].size, 2048);
  assert.equal(job.accessToken, 'download-token');
});
