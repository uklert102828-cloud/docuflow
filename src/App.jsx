import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, ChevronRight, Download, FileOutput, FileText,
  Images, LoaderCircle, LockKeyhole, LogOut, Package, Plus, RotateCcw,
  ShieldCheck, Trash2, Upload, X,
} from 'lucide-react';

const MODES = [
  { id: 'pdf-to-word', label: 'PDF 转 Word', note: '支持文本与扫描 PDF', icon: FileText, accept: '.pdf', types: ['pdf'] },
  { id: 'word-to-pdf', label: 'Word 转 PDF', note: '支持 DOCX 与 DOC', icon: FileOutput, accept: '.doc,.docx', types: ['doc', 'docx'] },
  { id: 'images-to-pdf', label: '图片转 PDF', note: '合并 JPG、JPEG、PNG', icon: Images, accept: '.jpg,.jpeg,.png', types: ['jpg', 'jpeg', 'png'] },
];
const STATUS = {
  queued: ['排队中', 'queued'], running: ['转换中', 'running'], completed: ['已完成', 'completed'],
  failed: ['转换失败', 'failed'], canceled: ['已取消', 'canceled'], canceling: ['正在取消', 'running'],
};

function localId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function getClientId() {
  const saved = localStorage.getItem('docuflow_client_id');
  if (saved) return saved;
  const id = `web-${localId()}-${localId()}`;
  localStorage.setItem('docuflow_client_id', id);
  return id;
}
const CLIENT_ID = getClientId();

function formatBytes(value) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function api(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers: { 'X-Client-ID': CLIENT_ID, ...(options.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '请求失败');
  }
  return response.status === 204 ? null : response.json();
}

function downloadUrl(job, suffix) {
  return `${API_BASE}/api/jobs/${job.id}/${suffix}?token=${encodeURIComponent(job.accessToken || '')}`;
}

function Brand() {
  return <div className="brand"><span className="brand-mark">流</span><span>流转</span></div>;
}

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setLoading(true); setError('');
    try {
      await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      onLogin();
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  return (
    <main className="login-shell">
      <div className="login-top"><Brand /><span className="private-label"><ShieldCheck size={15} /> 团队专用</span></div>
      <form className="login-panel" onSubmit={submit}>
        <div className="login-icon"><LockKeyhole size={25} /></div>
        <p className="eyebrow">安全访问</p>
        <h1>输入团队密码</h1>
        <p className="login-copy">验证后，这台设备将在 7 天内保持登录。</p>
        <label className="password-field">
          <span>访问密码</span>
          <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary wide" disabled={!password || loading}>
          {loading ? <LoaderCircle className="spin" size={18} /> : <>进入工作台 <ChevronRight size={18} /></>}
        </button>
      </form>
      <p className="login-foot">文件仅在服务器中临时处理，每日自动清理</p>
    </main>
  );
}

function ModeTabs({ active, onChange }) {
  return <div className="mode-tabs" role="tablist">{MODES.map((mode) => {
    const Icon = mode.icon;
    return <button key={mode.id} role="tab" aria-selected={active === mode.id} className={active === mode.id ? 'active' : ''} onClick={() => onChange(mode.id)}>
      <Icon size={20} /><span><strong>{mode.label}</strong><small>{mode.note}</small></span>
    </button>;
  })}</div>;
}

function EmptyUpload({ mode, onFiles, inputRef }) {
  const [dragging, setDragging] = useState(false);
  function drop(event) {
    event.preventDefault(); setDragging(false);
    onFiles([...event.dataTransfer.files]);
  }
  return (
    <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <div className="upload-symbol"><Upload size={24} /></div>
      <h2>选择{mode.id === 'images-to-pdf' ? '图片' : '文件'}开始转换</h2>
      <p className="desktop-hint">拖放到这里，或点击下方按钮</p>
      <p className="mobile-hint">从设备中选择文件</p>
      <button className="secondary" onClick={() => inputRef.current?.click()}><Plus size={18} /> 选择文件</button>
      <p className="limits">单次最多 20 个文件，合计不超过 50 MB</p>
    </div>
  );
}

function FileList({ items, imageMode, onRemove, onMove }) {
  const [dragId, setDragId] = useState(null);
  function dropOn(targetId) {
    if (!dragId || dragId === targetId) return;
    const from = items.findIndex((item) => item.id === dragId);
    const to = items.findIndex((item) => item.id === targetId);
    onMove(from, to); setDragId(null);
  }
  return <div className={`file-list ${imageMode ? 'image-list' : ''}`}>{items.map((item, index) => (
    <div className="file-row" key={item.id} draggable={imageMode} onDragStart={() => setDragId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(item.id)}>
      {imageMode ? <img src={item.preview} alt="" /> : <span className="file-type">{item.ext.toUpperCase()}</span>}
      <div className="file-meta"><strong title={item.file.name}>{item.file.name}</strong><span>{formatBytes(item.file.size)}</span></div>
      {imageMode && <div className="reorder-actions">
        <button className="icon-button" aria-label="上移" title="上移" disabled={index === 0} onClick={() => onMove(index, index - 1)}><ArrowUp size={16} /></button>
        <button className="icon-button" aria-label="下移" title="下移" disabled={index === items.length - 1} onClick={() => onMove(index, index + 1)}><ArrowDown size={16} /></button>
      </div>}
      <button className="icon-button remove" aria-label={`删除 ${item.file.name}`} title="删除" onClick={() => onRemove(item.id)}><Trash2 size={17} /></button>
    </div>
  ))}</div>;
}

function ImageSettings({ settings, setSettings }) {
  return <div className="settings-row">
    <div><span className="setting-label">纸张尺寸</span><div className="segmented">
      <button className={settings.paper === 'a4' ? 'selected' : ''} onClick={() => setSettings({ ...settings, paper: 'a4' })}>A4</button>
      <button className={settings.paper === 'original' ? 'selected' : ''} onClick={() => setSettings({ ...settings, paper: 'original' })}>按图片大小</button>
    </div></div>
    <div><span className="setting-label">页面方向</span><div className="segmented">
      <button className={settings.orientation === 'auto' ? 'selected' : ''} onClick={() => setSettings({ ...settings, orientation: 'auto' })}>自动</button>
      <button className={settings.orientation === 'portrait' ? 'selected' : ''} onClick={() => setSettings({ ...settings, orientation: 'portrait' })}>纵向</button>
      <button className={settings.orientation === 'landscape' ? 'selected' : ''} onClick={() => setSettings({ ...settings, orientation: 'landscape' })}>横向</button>
    </div></div>
  </div>;
}

function Task({ job, onCancel, onRetry }) {
  const [label, tone] = STATUS[job.status] || [job.status, 'queued'];
  const active = ['queued', 'running', 'canceling'].includes(job.status);
  return <article className="task-card">
    <div className="task-head">
      <div><span className={`status-dot ${tone}`}>{tone === 'running' && <LoaderCircle size={13} className="spin" />}{tone === 'completed' && <Check size={13} />}</span><div><strong>{MODES.find((mode) => mode.id === job.kind)?.label}</strong><span>{job.files.length} 个文件 · {label}</span></div></div>
      {active && <button className="text-button danger" onClick={() => onCancel(job.id)}><X size={16} /> 取消</button>}
      {!active && job.status !== 'completed' && <button className="text-button" onClick={() => onRetry(job.kind)}><RotateCcw size={16} /> 重新转换</button>}
    </div>
    <div className="task-files">{job.files.map((file) => <div key={file.id}>
      <span className={`mini-state ${STATUS[file.status]?.[1] || 'queued'}`}></span><span title={file.name}>{file.name}</span><small>{STATUS[file.status]?.[0]}</small>
      {file.error && <p>{file.error}</p>}
    </div>)}</div>
    {job.error && <p className="task-error">{job.error}</p>}
    {job.outputs?.length > 0 && <div className="downloads">
      {job.outputs.map((output) => <a className="download-item" key={output.id} href={downloadUrl(job, `outputs/${output.id}`)}><FileOutput size={17} /><span>{output.name}</span><small>{formatBytes(output.size)}</small><Download size={17} /></a>)}
      <a className="secondary compact" href={downloadUrl(job, 'download-all')}><Package size={17} /> 打包下载 ZIP</a>
    </div>}
  </article>;
}

export default function App() {
  const [auth, setAuth] = useState(null);
  const [publicAccess, setPublicAccess] = useState(false);
  const [modeId, setModeId] = useState('pdf-to-word');
  const [files, setFiles] = useState([]);
  const [settings, setSettings] = useState({ paper: 'a4', orientation: 'auto' });
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const mode = MODES.find((item) => item.id === modeId);
  const totalSize = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files]);

  useEffect(() => {
    api('/api/auth').then((data) => { setAuth(data.authenticated); setPublicAccess(Boolean(data.publicAccess)); }).catch(() => setAuth(false));
  }, []);
  useEffect(() => {
    if (!auth) return;
    api('/api/jobs/active').then(setJobs).catch(() => {});
  }, [auth]);
  useEffect(() => {
    if (!auth || !jobs.some((job) => ['queued', 'running', 'canceling'].includes(job.status))) return;
    const timer = setInterval(async () => {
      const next = await Promise.all(jobs.map(async (job) => ['queued', 'running', 'canceling'].includes(job.status) ? api(`/api/jobs/${job.id}`).catch(() => job) : job));
      setJobs(next);
    }, 1500);
    return () => clearInterval(timer);
  }, [auth, jobs]);

  function resetFiles() {
    files.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    setFiles([]); setError('');
    if (inputRef.current) inputRef.current.value = '';
  }
  function changeMode(next) { resetFiles(); setModeId(next); }
  function addFiles(selected) {
    setError('');
    const room = 20 - files.length;
    if (selected.length > room) return setError('一次最多上传 20 个文件');
    const normalized = selected.map((file) => ({ file, id: localId(), ext: file.name.split('.').pop()?.toLowerCase() || '', preview: modeId === 'images-to-pdf' ? URL.createObjectURL(file) : null }));
    const invalid = normalized.find((item) => !mode.types.includes(item.ext));
    if (invalid) { normalized.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)); return setError(`不支持此文件：${invalid.file.name}`); }
    if (totalSize + normalized.reduce((sum, item) => sum + item.file.size, 0) > 50 * 1024 * 1024) {
      normalized.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)); return setError('单次上传总大小不能超过 50 MB');
    }
    setFiles((current) => [...current, ...normalized]);
  }
  function removeFile(id) {
    setFiles((current) => { const target = current.find((item) => item.id === id); if (target?.preview) URL.revokeObjectURL(target.preview); return current.filter((item) => item.id !== id); });
  }
  function moveFile(from, to) {
    if (to < 0 || to >= files.length) return;
    setFiles((current) => { const next = [...current]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
  }
  async function submit() {
    setSubmitting(true); setError('');
    const body = new FormData();
    body.append('kind', modeId); body.append('settings', JSON.stringify(settings));
    files.forEach((item) => body.append('files', item.file));
    try {
      const job = await api('/api/jobs', { method: 'POST', body });
      setJobs((current) => [job, ...current]); resetFiles();
    } catch (err) { setError(err.message); } finally { setSubmitting(false); }
  }
  async function cancel(id) {
    try { await api(`/api/jobs/${id}/cancel`, { method: 'POST' }); setJobs((current) => current.map((job) => job.id === id ? { ...job, status: 'canceling' } : job)); }
    catch (err) { setError(err.message); }
  }
  async function logout() { await api('/api/auth/logout', { method: 'POST' }); setAuth(false); setJobs([]); resetFiles(); }

  if (auth === null) return <div className="boot"><LoaderCircle className="spin" /></div>;
  if (!auth) return <Login onLogin={() => setAuth(true)} />;
  return (
    <div className="app-shell">
      <header><Brand /><div className="header-meta"><span><ShieldCheck size={15} /> {publicAccess ? '公开服务' : '团队空间'}</span>{!publicAccess && <button className="icon-button" title="退出" aria-label="退出" onClick={logout}><LogOut size={18} /></button>}</div></header>
      <main className="workspace">
        <div className="workspace-title"><div><p className="eyebrow">文档工作台</p><h1>转换文件</h1></div><p>文件每日 03:00 自动清理</p></div>
        <ModeTabs active={modeId} onChange={changeMode} />
        <section className="converter">
          <input ref={inputRef} hidden type="file" multiple accept={mode.accept} onChange={(event) => addFiles([...event.target.files])} />
          {!files.length ? <EmptyUpload mode={mode} onFiles={addFiles} inputRef={inputRef} /> : <>
            <div className="selection-head"><div><h2>已选择 {files.length} 个文件</h2><p>共 {formatBytes(totalSize)}</p></div><button className="secondary compact" onClick={() => inputRef.current?.click()}><Plus size={17} /> 继续添加</button></div>
            <FileList items={files} imageMode={modeId === 'images-to-pdf'} onRemove={removeFile} onMove={moveFile} />
            {modeId === 'images-to-pdf' && <ImageSettings settings={settings} setSettings={setSettings} />}
            <div className="action-row"><button className="text-button" onClick={resetFiles}>清空</button><button className="primary" disabled={submitting} onClick={submit}>{submitting ? <LoaderCircle className="spin" size={18} /> : <><Upload size={18} /> 开始转换</>}</button></div>
          </>}
          {error && <div className="inline-error"><X size={17} />{error}</div>}
        </section>
        {jobs.length > 0 && <section className="tasks"><div className="section-heading"><h2>当前任务</h2><span>{jobs.length}</span></div>{jobs.map((job) => <Task key={job.id} job={job} onCancel={cancel} onRetry={changeMode} />)}</section>}
      </main>
      <footer><Brand /><span>内部文档转换服务</span></footer>
    </div>
  );
}
