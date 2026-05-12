/**
 * Flowboard AI — Data Layer
 */
const COLUMN_TYPES = [
  { type: 'backlog',     title: 'Backlog',      color: '#6b7280', icon: 'clipboard-list' },
  { type: 'ready',       title: 'Ready',        color: '#3b82f6', icon: 'target' },
  { type: 'running',     title: 'Running',      color: '#f59e0b', icon: 'zap' },
  { type: 'needs-input', title: 'Needs Input',  color: '#a855f7', icon: 'message-circle' },
  { type: 'review',      title: 'Review',       color: '#06b6d4', icon: 'eye' },
  { type: 'done',        title: 'Done',         color: '#10b981', icon: 'check-circle-2' },
  { type: 'failed',      title: 'Failed',       color: '#ef4444', icon: 'x-circle' }
];

const PRIORITIES = ['critical','high','medium','low'];
const RUN_STATES = ['idle','queued','running','paused','completed','failed','needs-input'];

function uid() {
  return 'id_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
}

function createDefaultProject(name, folderPath) {
  return {
    id: uid(),
    name: name || 'Untitled',
    folderPath: folderPath || '',
    description: '',
    color: '#6366f1',
    defaultProviderId: null,
    defaultModel: null,
    updatedAt: Date.now(),
    columns: COLUMN_TYPES.map(ct => ({
      id: uid(), title: ct.title, type: ct.type, cards: []
    })),
    chatThreads: [],
    runs: [],
    artifacts: []
  };
}

function createTask(overrides = {}) {
  return {
    id: uid(),
    title: '',
    description: '',
    priority: 'medium',
    label: '',
    assignee: '',
    origin: 'human',
    inputPrompt: '',
    outputSummary: '',
    assignedAgent: '',
    runState: 'idle',
    artifacts: [],
    executionHistory: [],
    statusHistory: [],
    lastRunAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  };
}

function createChatThread(title) {
  return { id: uid(), title: title || 'New Chat', messages: [], modelId: null, systemPrompt: '', createdAt: Date.now() };
}

function createAppState() {
  return {
    version: 2,
    recentProjects: [],
    settings: { theme: 'dark', density: 'comfortable', defaultProviderId: null, sidebarCollapsed: false, aiPanelOpen: true, missionControlOpen: false },
    activityLog: [],
    stats: { totalRuns: 0, totalTokens: 0, totalCost: 0, toolsUsed: {}, runsPerDay: {} }
  };
}

function addActivity(log, entry) {
  log.unshift({ id: uid(), ts: Date.now(), ...entry });
  if (log.length > 200) log.length = 200;
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'Just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Local persistence for app-level settings (not project data)
const APP_STORAGE_KEY = 'flowboard-ai-app';

function loadAppSettings() {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (raw) { const d = JSON.parse(raw); if (d && d.version === 2) return d; }
  } catch {}
  return createAppState();
}

function saveAppSettings(s) {
  try { localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(s)); } catch {}
}

// Server API helpers
async function apiPost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function apiGet(url) { const r = await fetch(url); return r.json(); }
async function apiPut(url, body) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function apiDelete(url) { const r = await fetch(url, { method: 'DELETE' }); return r.json(); }
