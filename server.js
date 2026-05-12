/**
 * Flowboard AI — Server
 * Express proxy for AI calls + file-system project management
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const FLOWBOARD_DIR = '.flowboard';
const STATE_FILE = 'state.json';
const PROVIDERS_FILE = path.join(__dirname, '.providers.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ────────────────────────────────────────────
function validateProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') return false;
  // Must be absolute path
  if (!path.isAbsolute(projectPath)) return false;
  // Must exist and be a directory
  try { return fs.existsSync(projectPath) && fs.statSync(projectPath).isDirectory(); }
  catch { return false; }
}

function ensureFlowboardDir(projectPath) {
  const dir = path.join(projectPath, FLOWBOARD_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readProjectState(projectPath) {
  const file = path.join(projectPath, FLOWBOARD_DIR, STATE_FILE);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function writeProjectState(projectPath, state) {
  const dir = ensureFlowboardDir(projectPath);
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2), 'utf-8');
}

function loadProviders() {
  if (!fs.existsSync(PROVIDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf-8')); } catch { return []; }
}

function saveProviders(providers) {
  fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(providers, null, 2), 'utf-8');
}

function maskKey(key) {
  if (!key || key.length < 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

// ─── Folder browsing ────────────────────────────────────
app.post('/api/browse', (req, res) => {
  const dir = req.body.path || (process.platform === 'win32' ? 'C:\\' : '/');
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return res.status(400).json({ error: 'Not a valid directory' });
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(dir);
    res.json({ current: dir, parent: parent !== dir ? parent : null, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Project State CRUD ─────────────────────────────────
app.post('/api/project/load', (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath) return res.status(400).json({ error: 'projectPath required' });
  const state = readProjectState(projectPath);
  res.json({ state, exists: !!state });
});

app.post('/api/project/save', (req, res) => {
  const { projectPath, state } = req.body;
  if (!projectPath || !state) return res.status(400).json({ error: 'projectPath and state required' });
  try {
    writeProjectState(projectPath, state);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Provider CRUD ──────────────────────────────────────
app.get('/api/providers', (req, res) => {
  const providers = loadProviders();
  const safe = providers.map(p => ({ ...p, apiKey: maskKey(p.apiKey) }));
  res.json(safe);
});

app.post('/api/providers', (req, res) => {
  const providers = loadProviders();
  const p = { ...req.body, id: 'prov_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
  providers.push(p);
  saveProviders(providers);
  res.json({ ...p, apiKey: maskKey(p.apiKey) });
});

app.put('/api/providers/:id', (req, res) => {
  const providers = loadProviders();
  const idx = providers.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Provider not found' });
  const updated = { ...providers[idx], ...req.body, id: req.params.id };
  if (req.body.apiKey === providers[idx].apiKey || !req.body.apiKey) {
    updated.apiKey = providers[idx].apiKey;
  }
  providers[idx] = updated;
  saveProviders(providers);
  res.json({ ...updated, apiKey: maskKey(updated.apiKey) });
});

app.delete('/api/providers/:id', (req, res) => {
  let providers = loadProviders();
  providers = providers.filter(p => p.id !== req.params.id);
  saveProviders(providers);
  res.json({ ok: true });
});

// ─── Test Connection ────────────────────────────────────
app.post('/api/providers/:id/test', async (req, res) => {
  const providers = loadProviders();
  const provider = providers.findIndex(p => p.id === req.params.id);
  if (provider === -1) return res.status(404).json({ error: 'Provider not found' });
  const p = providers[provider];
  try {
    const url = new URL((p.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/models');
    const mod = url.protocol === 'https:' ? https : http;
    const headers = { 'Authorization': `Bearer ${p.apiKey}`, ...(p.customHeaders || {}) };
    await new Promise((resolve, reject) => {
      const r = mod.get(url.href, { headers, timeout: (p.timeout || 10000) }, (resp) => {
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(data);
          else reject(new Error(`HTTP ${resp.statusCode}: ${data.slice(0, 200)}`));
        });
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Connection timeout')); });
    });
    providers[provider].connectionStatus = 'connected';
    saveProviders(providers);
    res.json({ status: 'connected' });
  } catch (err) {
    providers[provider].connectionStatus = 'error';
    saveProviders(providers);
    res.json({ status: 'error', message: err.message });
  }
});

// ─── AI Chat Proxy ──────────────────────────────────────
app.post('/api/ai/chat', async (req, res) => {
  const { providerId, model, messages, temperature, maxTokens, stream } = req.body;
  const providers = loadProviders();
  const provider = providers.find(p => p.id === providerId);
  if (!provider) return res.status(400).json({ error: 'Provider not configured' });
  const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = new URL(baseUrl + '/chat/completions');
  const body = JSON.stringify({
    model: model || provider.defaultModel || 'gpt-3.5-turbo',
    messages,
    temperature: temperature ?? provider.defaultTemp ?? 0.7,
    max_tokens: maxTokens || provider.maxTokens || 2048,
    stream: !!stream
  });
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${provider.apiKey}`,
    ...(provider.customHeaders || {})
  };
  const mod = url.protocol === 'https:' ? https : http;

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const r = mod.request(url.href, { method: 'POST', headers, timeout: provider.timeout || 60000 }, (resp) => {
      resp.on('data', chunk => res.write(chunk));
      resp.on('end', () => res.end());
    });
    r.on('error', err => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });
    r.write(body);
    r.end();
  } else {
    try {
      const data = await new Promise((resolve, reject) => {
        const r = mod.request(url.href, { method: 'POST', headers, timeout: provider.timeout || 60000 }, (resp) => {
          let d = '';
          resp.on('data', c => d += c);
          resp.on('end', () => {
            if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(JSON.parse(d));
            else reject(new Error(`HTTP ${resp.statusCode}: ${d.slice(0, 500)}`));
          });
        });
        r.on('error', reject);
        r.write(body);
        r.end();
      });
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }
});

// ─── Agent Execution (SSE) ──────────────────────────────
const { AgentSession, listPresets, estimateCost, countTokens, undoSession, getBackups, startWatcher, stopWatcher, exportAsMarkdown } = require('./agent/loop');
const { getFileChanges } = require('./agent/tools');
const { MCPManager } = require('./agent/mcp');
const { loadAllSkills, listSkillNames, getSkillByName, detectSkill } = require('./agent/skills');
const { loadProjectMemory, appendProjectMemory, resetProjectMemory, listKnowledge, addKnowledge, removeKnowledge } = require('./agent/memory');
const { listBriefings, loadBriefing, saveBriefing, deleteBriefing } = require('./agent/hooks');
const activeSessions = new Map();
const mcpManager = new MCPManager();

// #14 List presets + skills
app.get('/api/agent/presets', (req, res) => {
  const presets = listPresets().map(name => ({ name, type: 'preset' }));
  const skills = listSkillNames().map(s => ({ name: s.name, description: s.description, type: 'skill' }));
  res.json({ presets, skills });
});

// #13 Cost estimation
app.post('/api/agent/estimate', (req, res) => {
  const { model, prompt, messagesLength } = req.body;
  const tokens = countTokens(prompt) + (messagesLength || 0);
  res.json(estimateCost(model || 'gpt-4o', tokens));
});

// #10 MCP server management
app.post('/api/mcp/add', async (req, res) => {
  const tools = await mcpManager.addServer(req.body);
  res.json({ tools });
});
app.post('/api/mcp/remove', (req, res) => {
  mcpManager.removeServer(req.body.name);
  res.json({ ok: true });
});
app.get('/api/mcp/tools', (req, res) => res.json(mcpManager.getAllTools()));

// #12 File watcher — get recent file changes
app.get('/api/agent/file-changes', (req, res) => res.json(getFileChanges()));

// Main agent run endpoint (supports #1 auto-approve, #3 context, #5 multi-turn, #14 presets)
app.post('/api/agent/run', (req, res) => {
  const { providerId, model, projectPath, prompt, sessionId, autoApprove, preset, skill, existingMessages, briefing, tokenBudget } = req.body;
  const providers = loadProviders();
  const provider = providers.find(p => p.id === providerId);
  if (!provider) return res.status(400).json({ error: 'Provider not configured' });
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt required' });

  const sid = sessionId || 'ses_' + Date.now().toString(36);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  // #5 Reuse existing session for multi-turn
  let session = activeSessions.get(sid);
  if (!session) {
    // Resolve skill content if skill name provided, or auto-detect
    let skillContent = null;
    let detectedSkillName = skill || null;
    if (!detectedSkillName) {
      detectedSkillName = detectSkill(prompt);
    }
    if (detectedSkillName) {
      const skillData = getSkillByName(detectedSkillName);
      if (skillData) skillContent = skillData.content;
      send({ type: 'skill_detected', skill: detectedSkillName });
    }

    // Load briefing if specified
    let briefingContent = null;
    if (briefing) {
      briefingContent = loadBriefing(projectPath, briefing);
      if (briefingContent) send({ type: 'briefing_loaded', briefing });
    }

    session = new AgentSession({
      provider, model, projectRoot: projectPath,
      onEvent: send,
      autoApprove: autoApprove || false,
      preset: preset || 'default',
      skillContent: [skillContent, briefingContent].filter(Boolean).join('\n\n') || null,
      existingMessages: existingMessages || null,
      tokenBudget: tokenBudget || null,
      sessionId: sid
    });
    activeSessions.set(sid, session);
  } else {
    session.onEvent = send;
    session.autoApprove = autoApprove || session.autoApprove;
  }

  send({ type: 'session_start', sessionId: sid });

  session.run(prompt).catch(err => {
    send({ type: 'error', content: err.message });
  }).finally(() => {
    send({ type: 'stream_end', messages: session.getMessages(), tokenUsage: session.getTokenUsage() });
    if (!res.writableEnded) res.end();
  });

  req.on('close', () => { session.abort(); });
});

// #8 Retry with error context
app.post('/api/agent/retry', (req, res) => {
  const { sessionId, errorContext, projectPath, providerId, model, autoApprove, preset } = req.body;
  const providers = loadProviders();
  const provider = providers.find(p => p.id === providerId);
  if (!provider) return res.status(400).json({ error: 'Provider not configured' });

  const sid = sessionId || 'ses_' + Date.now().toString(36);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  let session = activeSessions.get(sid);
  if (!session) {
    session = new AgentSession({ provider, model, projectRoot: projectPath, onEvent: send, autoApprove, preset });
    activeSessions.set(sid, session);
  } else {
    session.onEvent = send;
  }

  send({ type: 'session_start', sessionId: sid });

  session.retry(errorContext).catch(err => {
    send({ type: 'error', content: err.message });
  }).finally(() => {
    send({ type: 'stream_end', messages: session.getMessages(), tokenUsage: session.getTokenUsage() });
    if (!res.writableEnded) res.end();
  });

  req.on('close', () => { session.abort(); });
});

// #9 Parallel card execution
app.post('/api/agent/run-parallel', async (req, res) => {
  const { tasks, providerId, model, projectPath, autoApprove, preset, concurrency } = req.body;
  const providers = loadProviders();
  const provider = providers.find(p => p.id === providerId);
  if (!provider) return res.status(400).json({ error: 'Provider not configured' });

  const limit = Math.min(concurrency || 3, 5);
  const results = [];
  let running = 0;
  let idx = 0;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  function next() {
    while (running < limit && idx < tasks.length) {
      const task = tasks[idx];
      const taskIdx = idx++;
      running++;

      const session = new AgentSession({
        provider, model, projectRoot: projectPath,
        onEvent: (evt) => send({ ...evt, taskId: task.id, taskIdx }),
        autoApprove: autoApprove || false, preset
      });

      session.run(task.prompt || task.title).then(() => {
        results.push({ taskId: task.id, status: 'done', tokenUsage: session.getTokenUsage() });
      }).catch(err => {
        results.push({ taskId: task.id, status: 'error', error: err.message });
      }).finally(() => {
        running--;
        send({ type: 'task_complete', taskId: task.id, taskIdx, total: tasks.length, completed: results.length });
        if (results.length === tasks.length) {
          send({ type: 'all_done', results });
          if (!res.writableEnded) res.end();
        } else {
          next();
        }
      });
    }
  }

  send({ type: 'parallel_start', total: tasks.length, concurrency: limit });
  next();
});

app.post('/api/agent/approve', (req, res) => {
  const { sessionId, callId, approved } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (approved) session.approve(callId);
  else session.deny(callId);
  res.json({ ok: true });
});

app.post('/api/agent/answer', (req, res) => {
  const { sessionId, callId, answer } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.answerQuestion(callId, answer || '');
  res.json({ ok: true });
});

app.post('/api/agent/abort', (req, res) => {
  const { sessionId } = req.body;
  const session = activeSessions.get(sessionId);
  if (session) { session.abort(); activeSessions.delete(sessionId); }
  res.json({ ok: true });
});

app.post('/api/agent/compact', (req, res) => {
  const { sessionId } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const before = session._getContextTokens();
  session.compact();
  const after = session._getContextTokens();
  res.json({ ok: true, tokensBefore: before, tokensAfter: after, saved: before - after });
});

// #2 Conversation persistence — save/load per card
function sanitizeCardId(id) {
  if (!id) return null;
  // Only allow alphanumeric, dash, underscore
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

app.post('/api/agent/history/save', (req, res) => {
  const { projectPath, cardId, messages, tokenUsage } = req.body;
  if (!projectPath || !cardId) return res.status(400).json({ error: 'projectPath and cardId required' });
  const safeId = sanitizeCardId(cardId);
  if (!safeId) return res.status(400).json({ error: 'Invalid cardId' });
  const dir = path.join(projectPath, FLOWBOARD_DIR, 'agent-history');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${safeId}.json`);
  // Double-check path is within expected directory
  if (!path.resolve(filePath).startsWith(path.resolve(dir))) return res.status(400).json({ error: 'Invalid path' });
  fs.writeFileSync(filePath, JSON.stringify({ messages, tokenUsage, updatedAt: Date.now() }, null, 2));
  res.json({ ok: true });
});

app.post('/api/agent/history/load', (req, res) => {
  const { projectPath, cardId } = req.body;
  if (!projectPath || !cardId) return res.status(400).json({ error: 'projectPath and cardId required' });
  const safeId = sanitizeCardId(cardId);
  if (!safeId) return res.json({ messages: [], tokenUsage: null });
  const dir = path.join(projectPath, FLOWBOARD_DIR, 'agent-history');
  const filePath = path.join(dir, `${safeId}.json`);
  if (!path.resolve(filePath).startsWith(path.resolve(dir))) return res.json({ messages: [], tokenUsage: null });
  if (!fs.existsSync(filePath)) return res.json({ messages: [], tokenUsage: null });
  try { res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8'))); }
  catch { res.json({ messages: [], tokenUsage: null }); }
});

// ─── Undo, Export, Watcher, Fork ─────────────────────────
app.post('/api/agent/search-history', (req, res) => {
  const { projectPath, query } = req.body;
  if (!projectPath || !validateProjectPath(projectPath) || !query) return res.status(400).json({ error: 'projectPath and query required' });
  const dir = path.join(projectPath, FLOWBOARD_DIR, 'agent-history');
  if (!fs.existsSync(dir)) return res.json({ results: [] });
  const results = [];
  const q = query.toLowerCase();
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      if (!data.messages) continue;
      for (const msg of data.messages) {
        const content = (msg.content || '').toLowerCase();
        if (content.includes(q)) {
          results.push({ cardId: file.replace('.json', ''), role: msg.role || msg.type, snippet: (msg.content || '').slice(0, 150), ts: data.updatedAt });
          break;
        }
      }
    }
  } catch {}
  res.json({ results: results.slice(0, 20) });
});

app.post('/api/agent/undo', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const result = undoSession(sessionId);
  res.json(result);
});

app.post('/api/agent/export', (req, res) => {
  const { sessionId } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const md = exportAsMarkdown(session.getMessages(), session.getTokenUsage(), getFileChanges());
  res.json({ markdown: md });
});

app.post('/api/agent/fork', (req, res) => {
  const { sessionId, fromIndex } = req.body;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const forked = session.fork(fromIndex || session.getMessages().length - 1);
  const newSid = 'ses_' + Date.now().toString(36);
  activeSessions.set(newSid, forked);
  res.json({ sessionId: newSid, messageCount: forked.getMessages().length });
});

app.post('/api/agent/watch', (req, res) => {
  const { projectPath, action } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  if (action === 'start') { startWatcher(projectPath, () => {}); res.json({ ok: true, watching: true }); }
  else { stopWatcher(projectPath); res.json({ ok: true, watching: false }); }
});

// ─── Memory & Knowledge ─────────────────────────────────
app.post('/api/memory/read', (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  res.json({ memory: loadProjectMemory(projectPath) });
});

app.post('/api/memory/write', (req, res) => {
  const { projectPath, content } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  if (!content) return res.status(400).json({ error: 'content required' });
  appendProjectMemory(projectPath, content);
  res.json({ ok: true });
});

app.post('/api/memory/reset', (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  resetProjectMemory(projectPath);
  res.json({ ok: true });
});

app.post('/api/knowledge/list', (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  res.json({ files: listKnowledge(projectPath) });
});

app.post('/api/knowledge/add', (req, res) => {
  const { projectPath, name, content } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  const saved = addKnowledge(projectPath, name, content);
  res.json({ ok: true, name: saved });
});

app.post('/api/knowledge/remove', (req, res) => {
  const { projectPath, name } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  removeKnowledge(projectPath, name);
  res.json({ ok: true });
});

// ─── Briefings ──────────────────────────────────────────
app.post('/api/briefings/list', (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  res.json({ briefings: listBriefings(projectPath) });
});

app.post('/api/briefings/load', (req, res) => {
  const { projectPath, name } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  const content = loadBriefing(projectPath, name);
  if (!content) return res.status(404).json({ error: 'Briefing not found' });
  res.json({ name, content });
});

app.post('/api/briefings/save', (req, res) => {
  const { projectPath, name, content } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  const saved = saveBriefing(projectPath, name, content);
  res.json({ ok: true, name: saved });
});

app.post('/api/briefings/delete', (req, res) => {
  const { projectPath, name } = req.body;
  if (!projectPath || !validateProjectPath(projectPath)) return res.status(400).json({ error: 'Invalid projectPath' });
  deleteBriefing(projectPath, name);
  res.json({ ok: true });
});

// ─── Fallback SPA ───────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  Flowboard AI running at http://localhost:${PORT}\n`);
});
