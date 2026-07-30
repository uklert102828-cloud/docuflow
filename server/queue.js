import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { imagesToPdf, pdfToWord, wordToPdf } from './converter.js';

export function createQueue({ database, dataDir, tools }) {
  const { statements } = database;
  const pending = [];
  const controllers = new Map();
  let working = false;

  function updateJob(id, status, error = null) {
    statements.updateJob.run(status, error, Date.now(), id);
  }

  async function saveOutput(jobId, result) {
    const stat = await fs.stat(result.path);
    statements.insertOutput.run(crypto.randomUUID(), jobId, path.basename(result.path), result.name, stat.size);
  }

  async function processJob(jobId) {
    const row = statements.getJob.get(jobId);
    if (!row || row.status !== 'queued') return;
    const files = statements.getFiles.all(jobId);
    const jobDir = path.join(dataDir, 'jobs', jobId);
    const inputDir = path.join(jobDir, 'input');
    const outputDir = path.join(jobDir, 'output');
    const controller = new AbortController();
    controllers.set(jobId, controller);
    updateJob(jobId, 'running');
    await fs.mkdir(outputDir, { recursive: true });

    try {
      if (row.kind === 'images-to-pdf') {
        files.forEach((file) => statements.updateFile.run('running', null, file.id));
        const result = await imagesToPdf(files.map((file) => ({ ...file, path: path.join(inputDir, file.stored_name) })), outputDir, JSON.parse(row.settings_json));
        await saveOutput(jobId, result);
        files.forEach((file) => statements.updateFile.run('completed', null, file.id));
      } else {
        for (const file of files) {
          if (controller.signal.aborted) throw new DOMException('任务已取消', 'AbortError');
          statements.updateFile.run('running', null, file.id);
          try {
            const input = path.join(inputDir, file.stored_name);
            const result = row.kind === 'pdf-to-word'
              ? await pdfToWord(input, outputDir, file.original_name, tools, controller.signal)
              : await wordToPdf(input, outputDir, file.original_name, tools, controller.signal);
            await saveOutput(jobId, result);
            statements.updateFile.run('completed', null, file.id);
          } catch (error) {
            if (error.name === 'AbortError') throw error;
            statements.updateFile.run('failed', error.message, file.id);
          }
        }
      }
      const failed = statements.getFiles.all(jobId).filter((file) => file.status === 'failed').length;
      updateJob(jobId, failed === files.length ? 'failed' : 'completed', failed ? `${failed} 个文件转换失败` : null);
    } catch (error) {
      const canceled = controller.signal.aborted || error.name === 'AbortError';
      statements.getFiles.all(jobId).filter((file) => ['queued', 'running'].includes(file.status)).forEach((file) => {
        statements.updateFile.run(canceled ? 'canceled' : 'failed', canceled ? '任务已取消' : error.message, file.id);
      });
      updateJob(jobId, canceled ? 'canceled' : 'failed', canceled ? null : error.message);
    } finally {
      controllers.delete(jobId);
    }
  }

  async function drain() {
    if (working) return;
    working = true;
    while (pending.length) await processJob(pending.shift());
    working = false;
  }

  function enqueue(id) {
    if (!pending.includes(id)) pending.push(id);
    void drain();
  }

  function cancel(id) {
    const index = pending.indexOf(id);
    if (index >= 0) {
      pending.splice(index, 1);
      statements.getFiles.all(id).forEach((file) => statements.updateFile.run('canceled', '任务已取消', file.id));
      updateJob(id, 'canceled');
      return true;
    }
    const controller = controllers.get(id);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  statements.resetRunning.run(Date.now());
  statements.resetRunningFiles.run();
  statements.queuedJobs.all().forEach(({ id }) => enqueue(id));
  return { enqueue, cancel };
}
