import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { createDatabase } from './database.js';
import { createQueue } from './queue.js';
import { clearSessionCookie, createSessionToken, passwordMatches, sessionFromRequest, setSessionCookie } from './security.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data');
const port = Number(process.env.PORT || 3000);
const teamPassword = process.env.TEAM_PASSWORD || 'docuflow';
const sessionSecret = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`dev-${teamPassword}`).digest('hex');
const secureCookie = process.env.COOKIE_SECURE === 'true';
const publicAccess = process.env.PUBLIC_ACCESS === 'true';
const publicOrigin = (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
const maxBatchBytes = 50 * 1024 * 1024;
const maxFiles = 20;

await fsp.mkdir(path.join(dataDir, 'tmp'), { recursive: true });
await fsp.mkdir(path.join(dataDir, 'jobs'), { recursive: true });

const database = createDatabase(dataDir);
const queue = createQueue({
  database,
  dataDir,
  tools: {
    soffice: process.env.SOFFICE_BIN || 'soffice',
    ocrmypdf: process.env.OCRMY_PDF_BIN || 'ocrmypdf',
    python: process.env.PYTHON_BIN || 'python3',
  },
});
const { statements, hydrate } = database;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
  if (publicOrigin && req.headers.origin === publicOrigin) {
    res.setHeader('Access-Control-Allow-Origin', publicOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-ID');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json({ limit: '16kb' }));

const attempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < 15 * 60 * 1000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length <= 10;
}

function requireAuth(req, res, next) {
  if (publicAccess) {
    const clientId = req.get('X-Client-ID');
    if (req.query.token && !clientId) {
      req.session = { sid: null };
      return next();
    }
    if (!clientId || !/^[a-zA-Z0-9-]{12,80}$/.test(clientId)) return res.status(400).json({ error: '客户端标识无效，请刷新页面后重试' });
    req.session = { sid: clientId };
    return next();
  }
  const session = sessionFromRequest(req, sessionSecret);
  if (!session) return res.status(401).json({ error: '请先输入团队访问密码' });
  req.session = session;
  next();
}

app.get('/api/auth', (req, res) => {
  res.json({ authenticated: publicAccess || Boolean(sessionFromRequest(req, sessionSecret)), publicAccess });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/login', (req, res) => {
  if (publicAccess) return res.json({ authenticated: true, publicAccess: true });
  if (!loginAllowed(req.ip)) return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
  if (!passwordMatches(req.body?.password, teamPassword)) return res.status(401).json({ error: '访问密码不正确' });
  attempts.delete(req.ip);
  setSessionCookie(res, createSessionToken(sessionSecret), secureCookie);
  res.json({ authenticated: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res, secureCookie);
  res.status(204).end();
});

const upload = multer({
  dest: path.join(dataDir, 'tmp'),
  limits: { fileSize: maxBatchBytes, files: maxFiles },
});

const allowed = {
  'pdf-to-word': new Set(['.pdf']),
  'word-to-pdf': new Set(['.doc', '.docx']),
  'images-to-pdf': new Set(['.jpg', '.jpeg', '.png']),
};

const submissions = new Map();
function submissionAllowed(ip) {
  const now = Date.now();
  const recent = (submissions.get(ip) || []).filter((time) => now - time < 24 * 60 * 60 * 1000);
  if (recent.length >= 100) return false;
  recent.push(now);
  submissions.set(ip, recent);
  return true;
}

function requireCapacity(req, res, next) {
  if (!submissionAllowed(req.ip)) return res.status(429).json({ error: '今日提交次数已达上限，请明天再试' });
  if (statements.activeJobCount.get(req.session.sid).count >= 5) return res.status(429).json({ error: '当前已有 5 个任务，请等待任务完成后再提交' });
  next();
}

function cleanupTemp(files = []) {
  return Promise.allSettled(files.map((file) => fsp.rm(file.path, { force: true })));
}

app.post('/api/jobs', requireAuth, requireCapacity, upload.array('files', maxFiles), async (req, res, next) => {
  const files = req.files || [];
  try {
    const kind = req.body.kind;
    if (!allowed[kind]) throw Object.assign(new Error('不支持此转换类型'), { status: 400 });
    if (!files.length) throw Object.assign(new Error('请选择至少一个文件'), { status: 400 });
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > maxBatchBytes) throw Object.assign(new Error('单次上传总大小不能超过 50 MB'), { status: 413 });
    const invalid = files.find((file) => !allowed[kind].has(path.extname(file.originalname).toLowerCase()));
    if (invalid) throw Object.assign(new Error(`文件格式不支持：${invalid.originalname}`), { status: 400 });

    let settings = {};
    try { settings = JSON.parse(req.body.settings || '{}'); } catch { throw Object.assign(new Error('转换设置无效'), { status: 400 }); }
    if (kind === 'images-to-pdf') {
      settings.paper = ['a4', 'original'].includes(settings.paper) ? settings.paper : 'a4';
      settings.orientation = ['auto', 'portrait', 'landscape'].includes(settings.orientation) ? settings.orientation : 'auto';
    }

    const id = crypto.randomUUID();
    const accessToken = crypto.randomBytes(24).toString('base64url');
    const inputDir = path.join(dataDir, 'jobs', id, 'input');
    await fsp.mkdir(inputDir, { recursive: true });
    const now = Date.now();
    statements.insertJob.run(id, req.session.sid, kind, 'queued', JSON.stringify(settings), accessToken, now, now);
    for (const [index, file] of files.entries()) {
      const storedName = `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
      await fsp.rename(file.path, path.join(inputDir, storedName));
      statements.insertFile.run(crypto.randomUUID(), id, file.originalname, storedName, file.size, 'queued', index);
    }
    queue.enqueue(id);
    res.status(202).json(hydrate(statements.getJob.get(id)));
  } catch (error) {
    await cleanupTemp(files);
    next(error);
  }
});

app.get('/api/jobs/active', requireAuth, (req, res) => {
  res.json(statements.activeJobs.all(req.session.sid).map(hydrate));
});

function ownedJob(req, res, allowDownloadToken = false) {
  const row = statements.getJob.get(req.params.id);
  const ownerMatches = row && row.session_id === req.session.sid;
  const downloadTokenMatches = allowDownloadToken && row?.access_token && passwordMatches(req.query.token, row.access_token);
  if (!row || (!ownerMatches && !downloadTokenMatches)) {
    res.status(404).json({ error: '未找到此任务' });
    return null;
  }
  return row;
}

app.get('/api/jobs/:id', requireAuth, (req, res) => {
  const row = ownedJob(req, res);
  if (row) res.json(hydrate(row));
});

app.post('/api/jobs/:id/cancel', requireAuth, (req, res) => {
  const row = ownedJob(req, res);
  if (!row) return;
  if (!['queued', 'running'].includes(row.status)) return res.status(409).json({ error: '此任务已结束' });
  queue.cancel(row.id);
  res.status(202).json({ status: 'canceling' });
});

app.get('/api/jobs/:id/outputs/:outputId', requireAuth, (req, res) => {
  const row = ownedJob(req, res, true);
  if (!row) return;
  const output = statements.getOutputs.all(row.id).find((item) => item.id === req.params.outputId);
  if (!output) return res.status(404).json({ error: '文件不存在或已清理' });
  res.download(path.join(dataDir, 'jobs', row.id, 'output', output.stored_name), output.download_name);
});

app.get('/api/jobs/:id/download-all', requireAuth, (req, res, next) => {
  const row = ownedJob(req, res, true);
  if (!row) return;
  const outputs = statements.getOutputs.all(row.id);
  if (!outputs.length) return res.status(404).json({ error: '没有可下载的文件' });
  res.attachment(`转换结果-${row.id.slice(0, 8)}.zip`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', next);
  archive.pipe(res);
  outputs.forEach((output) => archive.file(path.join(dataDir, 'jobs', row.id, 'output', output.stored_name), { name: output.download_name }));
  void archive.finalize();
});

function beijingCutoff(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), -5, 0, 0);
}

async function cleanupFinished() {
  const cutoff = beijingCutoff();
  for (const { id } of statements.finishedBefore.all(cutoff)) {
    await fsp.rm(path.join(dataDir, 'jobs', id), { recursive: true, force: true });
    statements.deleteJob.run(id);
  }
  const temporaryFiles = await fsp.readdir(path.join(dataDir, 'tmp'), { withFileTypes: true });
  await Promise.allSettled(temporaryFiles.map((entry) => fsp.rm(path.join(dataDir, 'tmp', entry.name), { recursive: true, force: true })));
}
await cleanupFinished();
let cleanedDate = '';
setInterval(() => {
  const beijing = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const date = beijing.toISOString().slice(0, 10);
  if (beijing.getUTCHours() === 3 && cleanedDate !== date) {
    cleanedDate = date;
    void cleanupFinished();
  }
}, 60_000).unref();

const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => req.method === 'GET' ? res.sendFile(path.join(distDir, 'index.html')) : next());
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (req.files?.length) void cleanupTemp(req.files);
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_COUNT' ? '一次最多上传 20 个文件' : '单次上传总大小不能超过 50 MB';
    return res.status(413).json({ error: message });
  }
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : '服务器处理失败，请稍后重试' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`DocuFlow is running at http://localhost:${port}`);
  if (teamPassword === 'docuflow') console.warn('正在使用默认密码 docuflow，请在部署前设置 TEAM_PASSWORD。');
});
