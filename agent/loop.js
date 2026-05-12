/**
 * Flowboard AI — Agent Loop Engine (v3)
 * Improvements: streaming, cancel mid-tool, auto-retry, token budget,
 * progress indicator, undo, conversation branching, file watcher
 */
const { TOOL_DEFINITIONS, PERMISSIONS, executeTool, getFileChanges, clearFileChanges } = require('./tools');
const { buildMemoryContext, addLesson } = require('./memory');
const { loadHooks, runHook } = require('./hooks');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const MAX_ITERATIONS = 25;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 8000]; // exponential backoff

const COST_TABLE = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-3.5-sonnet': { input: 3, output: 15 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-v4-flash': { input: 0.14, output: 0.28 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87 },
  'mimo-v2.5-pro': { input: 0.6, output: 2.4 },
  'mimo-v2-pro': { input: 0.6, output: 2.4 },
  'mimo-v2.5': { input: 0.15, output: 0.6 },
  'mimo-v2-omni': { input: 0.15, output: 0.6 },
  'default': { input: 1, output: 3 }
};

const PRESETS = {
  default: `You are Flowboard Agent — an AI coding assistant embedded in a kanban board.
You help users complete tasks by reading, writing, and executing code in their project.
RULES:
- Always read relevant files before making changes
- Use tools to accomplish the task — don't just describe what to do
- After making changes, verify them
- Be concise in explanations
- Report what you did at the end
- Use memory_write to save important decisions, conventions, or architecture notes for future sessions
- Use memory_read to recall what was previously decided
- After completing a task, self-evaluate: what worked, what could be better, save lessons via memory_write
- If you encounter an error you've seen before (check memory), try a different approach immediately`,

  bugfix: `You are a Bug Fix Agent. Your job is to diagnose and fix bugs.
APPROACH:
1. Read the relevant code to understand the issue
2. Identify the root cause
3. Apply the minimal fix
4. Verify the fix works (run tests if available)
5. Report what was wrong and what you fixed`,

  feature: `You are a Feature Implementation Agent. You implement new features cleanly.
APPROACH:
1. Understand the requirement
2. Read existing code to understand patterns and conventions
3. Implement the feature following existing patterns
4. Add tests if a test framework exists
5. Report what was implemented`,

  refactor: `You are a Refactoring Agent. You improve code quality without changing behavior.
APPROACH:
1. Read the code to understand current structure
2. Identify improvement opportunities
3. Apply refactoring in small, safe steps
4. Verify nothing is broken after each change
5. Report what was improved`,

  test: `You are a Test Writing Agent. You write comprehensive tests.
APPROACH:
1. Read the source code to understand what to test
2. Identify the test framework in use
3. Write tests covering happy paths, edge cases, and error cases
4. Run the tests to verify they pass
5. Report test coverage summary`
};

function getPreset(name) { return PRESETS[name] || PRESETS.default; }
function listPresets() { return Object.keys(PRESETS); }

// ─── Context Builder ─────────────────────────────────────
const MAX_CONTEXT_INJECTION = 12000; // max tokens for injected context (leaves room for conversation)

function buildProjectContext(projectRoot) {
  let context = '';
  let budget = MAX_CONTEXT_INJECTION;

  function addIfBudget(text) {
    const tokens = countTokens(text);
    if (tokens > budget) { text = text.slice(0, budget * 4); budget = 0; }
    else { budget -= tokens; }
    context += text;
  }

  try {
    const tree = [];
    function walk(dir, depth) {
      if (depth > 2) return;
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === '__pycache__') continue;
          const rel = path.relative(projectRoot, path.join(dir, e.name)).replace(/\\/g, '/');
          tree.push(`${e.isDirectory() ? '[dir]' : '[file]'} ${rel}`);
          if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
        }
      } catch {}
    }
    walk(projectRoot, 0);
    addIfBudget(`\nPROJECT STRUCTURE:\n${tree.slice(0, 60).join('\n')}\n`);

    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath) && budget > 0) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      addIfBudget(`\nPACKAGE: ${pkg.name}@${pkg.version} — ${pkg.description || ''}\nDEPS: ${Object.keys(pkg.dependencies || {}).join(', ')}\nDEV: ${Object.keys(pkg.devDependencies || {}).join(', ')}\n`);
    }

    const readmePath = ['README.md', 'readme.md'].map(f => path.join(projectRoot, f)).find(f => fs.existsSync(f));
    if (readmePath && budget > 0) addIfBudget(`\nREADME:\n${fs.readFileSync(readmePath, 'utf-8').slice(0, 500)}\n`);

    if (budget > 0) {
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf-8', timeout: 5000 }).trim();
        const status = execSync('git status --short', { cwd: projectRoot, encoding: 'utf-8', timeout: 5000 }).trim();
        addIfBudget(`\nGIT: branch=${branch}${status ? '\nModified:\n' + status.slice(0, 500) : ''}\n`);
      } catch {}
    }

    if (budget > 0) {
      const envFile = path.join(projectRoot, '.env');
      if (fs.existsSync(envFile)) {
        const keys = fs.readFileSync(envFile, 'utf-8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => l.split('=')[0].trim());
        if (keys.length) addIfBudget(`\nENV VARS: ${keys.join(', ')}\n`);
      }
    }
  } catch {}
  return context;
}

// ─── Cost & Tokens ───────────────────────────────────────
function estimateCost(model, promptTokens) {
  const costs = COST_TABLE[model] || COST_TABLE.default;
  const estimatedOutput = Math.min(promptTokens * 2, 4096);
  return {
    estimatedInputTokens: promptTokens,
    estimatedOutputTokens: estimatedOutput,
    estimatedCost: ((promptTokens * costs.input + estimatedOutput * costs.output) / 1000000).toFixed(4),
    currency: 'USD'
  };
}

function countTokens(text) { return Math.ceil((text || '').length / 4); }

function getCostSoFar(model, usage) {
  const costs = COST_TABLE[model] || COST_TABLE.default;
  return (usage.input * costs.input + usage.output * costs.output) / 1000000;
}

// ─── File Backup for Undo ────────────────────────────────
const fileBackups = new Map(); // sessionId -> [{path, content}]

function backupFile(sessionId, projectRoot, filePath) {
  const fp = path.resolve(projectRoot, filePath);
  if (!fs.existsSync(fp)) return;
  if (!fileBackups.has(sessionId)) fileBackups.set(sessionId, []);
  const backups = fileBackups.get(sessionId);
  // Don't backup same file twice
  if (backups.some(b => b.path === fp)) return;
  backups.push({ path: fp, content: fs.readFileSync(fp, 'utf-8') });
}

function undoSession(sessionId) {
  const backups = fileBackups.get(sessionId);
  if (!backups || !backups.length) return { success: false, output: 'No backups found' };
  let restored = 0;
  for (const b of backups) {
    try { fs.writeFileSync(b.path, b.content, 'utf-8'); restored++; } catch {}
  }
  fileBackups.delete(sessionId);
  return { success: true, output: `Reverted ${restored} file(s)`, files: backups.map(b => b.path) };
}

function getBackups(sessionId) { return fileBackups.get(sessionId) || []; }

// ─── File Watcher ────────────────────────────────────────
const watchers = new Map();

function startWatcher(projectRoot, onChange) {
  if (watchers.has(projectRoot)) return;
  try {
    const watcher = fs.watch(projectRoot, { recursive: true }, (eventType, filename) => {
      if (!filename || filename.includes('node_modules') || filename.includes('.flowboard') || filename.startsWith('.')) return;
      onChange({ eventType, filename });
    });
    watchers.set(projectRoot, watcher);
  } catch {}
}

function stopWatcher(projectRoot) {
  const w = watchers.get(projectRoot);
  if (w) { w.close(); watchers.delete(projectRoot); }
}

// ─── Agent Session ───────────────────────────────────────
class AgentSession {
  constructor({ provider, model, projectRoot, onEvent, autoApprove, preset, skillContent, existingMessages, tokenBudget, sessionId }) {
    this.provider = provider;
    this.model = model;
    this.projectRoot = projectRoot;
    this.onEvent = onEvent || (() => {});
    this.autoApprove = autoApprove || false;
    this.aborted = false;
    this.pendingApproval = null;
    this.pendingQuestion = null;
    this.tokenUsage = { input: 0, output: 0, total: 0 };
    this.iterationCount = 0;
    this.hooks = loadHooks(projectRoot);
    this.tokenBudget = tokenBudget || null; // #7 max cost in USD
    this.sessionId = sessionId || 'ses_' + Date.now().toString(36);
    this.activeProcess = null; // #2 for cancel mid-tool
    this.contextLimit = provider.contextLimit || 128000; // tokens
    this.fallbackModels = provider.fallbackModels || []; // #2 model fallback

    if (existingMessages && existingMessages.length > 0) {
      this.messages = existingMessages;
    } else {
      let systemPrompt = getPreset(preset || 'default');
      if (skillContent) systemPrompt += '\n\n--- SKILL INSTRUCTIONS ---\n' + skillContent;
      const projectContext = buildProjectContext(projectRoot);
      const memoryContext = buildMemoryContext(projectRoot);
      this.messages = [{ role: 'system', content: systemPrompt + '\n' + projectContext + memoryContext }];
    }

    clearFileChanges();
  }

  abort() {
    this.aborted = true;
    // #2 Kill active process
    if (this.activeProcess) {
      try { this.activeProcess.kill('SIGTERM'); } catch {}
      this.activeProcess = null;
    }
  }

  getEstimate(userMessage) {
    const allText = this.messages.map(m => m.content || '').join('') + userMessage;
    return estimateCost(this.model, countTokens(allText));
  }

  // #6 Conversation branching — fork from message index
  fork(fromIndex) {
    const forked = new AgentSession({
      provider: this.provider, model: this.model, projectRoot: this.projectRoot,
      onEvent: this.onEvent, autoApprove: this.autoApprove, tokenBudget: this.tokenBudget,
      existingMessages: this.messages.slice(0, fromIndex + 1)
    });
    forked.tokenUsage = { ...this.tokenUsage };
    return forked;
  }

  async run(userMessage) {
    this.messages.push({ role: 'user', content: userMessage });
    this.onEvent({ type: 'message', role: 'user', content: userMessage });
    await runHook(this.hooks, 'beforeRun', { message: userMessage, projectRoot: this.projectRoot });

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (this.aborted) { this.onEvent({ type: 'aborted' }); return; }
      this.iterationCount++;

      // #12 Progress indicator
      this.onEvent({ type: 'progress', step: this.iterationCount, maxSteps: MAX_ITERATIONS });

      // #7 Token budget check
      if (this.tokenBudget && getCostSoFar(this.model, this.tokenUsage) >= this.tokenBudget) {
        this.onEvent({ type: 'message', role: 'assistant', content: 'Token budget reached. Stopping.' });
        this.onEvent({ type: 'done', tokenUsage: this.tokenUsage, fileChanges: getFileChanges() });
        return;
      }

      // #3 Auto-retry with exponential backoff
      let response;
      // Auto-compact if approaching context limit (80% threshold)
      this._autoCompact();
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          response = await this._callLLMStreaming();
          break;
        } catch (err) {
          const status = err.statusCode || 0;
          const retryable = status === 429 || status === 500 || status === 502 || status === 503;
          if (retryable && attempt < MAX_RETRIES) {
            const delay = RETRY_DELAYS[attempt] || 8000;
            // Model fallback: try next model on repeated failures
            if (attempt >= 1 && this.fallbackModels.length > 0) {
              const fallback = this.fallbackModels.shift();
              this.onEvent({ type: 'model_fallback', from: this.model, to: fallback });
              this.model = fallback;
            }
            this.onEvent({ type: 'retry_attempt', attempt: attempt + 1, delay, error: err.message });
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          await runHook(this.hooks, 'onError', { error: err, projectRoot: this.projectRoot });
          addLesson(this.projectRoot, 'error', `LLM call failed: ${err.message} (model: ${this.model})`);
          this.onEvent({ type: 'error', content: err.message });
          return;
        }
      }

      if (response.usage) {
        this.tokenUsage.input += response.usage.prompt_tokens || 0;
        this.tokenUsage.output += response.usage.completion_tokens || 0;
        this.tokenUsage.total += response.usage.total_tokens || 0;
        this.onEvent({ type: 'token_usage', usage: this.tokenUsage, cost: getCostSoFar(this.model, this.tokenUsage).toFixed(4) });
      }

      const msg = response.choices?.[0]?.message;
      if (!msg) { this.onEvent({ type: 'error', content: 'Invalid LLM response' }); return; }
      this.messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Content already streamed via _callLLMStreaming
        if (!this._streamedContent) this.onEvent({ type: 'message', role: 'assistant', content: msg.content || '' });
        await runHook(this.hooks, 'afterRun', { messages: this.messages, projectRoot: this.projectRoot });
        this.onEvent({ type: 'done', tokenUsage: this.tokenUsage, fileChanges: getFileChanges() });
        return;
      }

      if (msg.content && !this._streamedContent) this.onEvent({ type: 'message', role: 'assistant', content: msg.content });
      this._streamedContent = false;

      for (const tc of msg.tool_calls) {
        if (this.aborted) return;
        const toolName = tc.function.name;
        let args;
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

        const permission = PERMISSIONS[toolName] || 'safe';

        // Sensitive files ALWAYS require manual approval (cannot be auto-approved)
        const SENSITIVE_PATTERNS = ['.env', '.pem', '.key', 'credentials', 'secret', '.token', 'id_rsa', '.pfx'];
        const targetPath = args.path || args.old_path || args.source || '';
        const isSensitive = SENSITIVE_PATTERNS.some(p => targetPath.toLowerCase().includes(p));

        if (permission === 'dangerous' && (!this.autoApprove || isSensitive)) {
          this.onEvent({ type: 'approval_request', toolName, args, callId: tc.id });
          const approved = await this._waitForApproval(tc.id);
          if (!approved) {
            this.messages.push({ role: 'tool', tool_call_id: tc.id, content: 'User denied permission.' });
            this.onEvent({ type: 'tool_denied', toolName, callId: tc.id });
            continue;
          }
        }

        // #5 Backup file before write/edit
        if (['write_file', 'edit_file', 'multi_edit', 'insert_lines', 'patch', 'delete_file'].includes(toolName) && args.path) {
          backupFile(this.sessionId, this.projectRoot, args.path);
        }

        this.onEvent({ type: 'tool_start', toolName, args, callId: tc.id });

        // #2 Use async spawn for bash (cancellable)
        let result;
        if (toolName === 'bash' && args.command) {
          result = await this._execBashAsync(args.command, args.timeout);
        } else {
          result = executeTool(toolName, args, this.projectRoot);
        }

        // Handle special tools
        if (result.output === '__ASK_USER__') {
          this.onEvent({ type: 'ask_user', question: result.question, options: result.options, default_answer: result.default_answer, callId: tc.id });
          const answer = await this._waitForUserAnswer(tc.id, result.default_answer);
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: `User answered: ${answer}` });
          this.onEvent({ type: 'user_answer', answer, callId: tc.id });
          continue;
        }
        if (result.output === '__SPAWN_SUBAGENT__') {
          this.onEvent({ type: 'subagent_start', task: result.task, callId: tc.id });
          const subResult = await this._runSubagent(result.task, result.context, result.preset);
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: subResult });
          this.onEvent({ type: 'subagent_done', result: subResult, callId: tc.id });
          continue;
        }

        this.onEvent({ type: 'tool_result', toolName, args, result, callId: tc.id });
        this.messages.push({ role: 'tool', tool_call_id: tc.id, content: result.output || '' });
        await runHook(this.hooks, 'afterToolExecution', { toolName, args, result, projectRoot: this.projectRoot });

        // Self-improvement: learn from tool failures
        if (!result.success && toolName !== 'grep') {
          addLesson(this.projectRoot, 'error', `${toolName} failed: ${(result.output || '').slice(0, 100)}`);
        }
        // Self-improvement: record successful task completion
        if (toolName === 'task_complete' && result.success) {
          addLesson(this.projectRoot, 'success', `Completed: ${(args.summary || '').slice(0, 150)}`);
        }
      }
    }

    this.onEvent({ type: 'message', role: 'assistant', content: 'Reached maximum iterations.' });
    this.onEvent({ type: 'done', tokenUsage: this.tokenUsage, fileChanges: getFileChanges() });
  }

  async retry(errorContext) {
    return this.run(`The previous attempt failed with this error:\n${errorContext}\n\nPlease try again with a different approach.`);
  }

  getMessages() { return this.messages; }
  getTokenUsage() { return this.tokenUsage; }

  approve(callId) { if (this.pendingApproval?.callId === callId) { this.pendingApproval.resolve(true); this.pendingApproval = null; } }
  deny(callId) { if (this.pendingApproval?.callId === callId) { this.pendingApproval.resolve(false); this.pendingApproval = null; } }
  answerQuestion(callId, answer) { if (this.pendingQuestion?.callId === callId) { this.pendingQuestion.resolve(answer); this.pendingQuestion = null; } }

  _waitForApproval(callId) {
    return new Promise(resolve => {
      this.pendingApproval = { callId, resolve };
      setTimeout(() => { if (this.pendingApproval?.callId === callId) { this.pendingApproval.resolve(false); this.pendingApproval = null; } }, 300000);
    });
  }

  _waitForUserAnswer(callId, defaultAnswer) {
    return new Promise(resolve => {
      this.pendingQuestion = { callId, resolve };
      setTimeout(() => { if (this.pendingQuestion?.callId === callId) { this.pendingQuestion.resolve(defaultAnswer || 'No response'); this.pendingQuestion = null; } }, 300000);
    });
  }

  // ─── Context Compaction ──────────────────────────────────
  _getContextTokens() {
    return this.messages.reduce((sum, m) => sum + countTokens(m.content || '') + countTokens(m.tool_calls ? JSON.stringify(m.tool_calls) : ''), 0);
  }

  _autoCompact() {
    const tokens = this._getContextTokens();
    if (tokens > this.contextLimit * 0.8) {
      this.compact();
      this.onEvent({ type: 'compacted', tokensBefore: tokens, tokensAfter: this._getContextTokens() });
    }
  }

  compact() {
    // Keep: system prompt (index 0), last 6 messages, and summarize the middle
    if (this.messages.length <= 8) return;
    const system = this.messages[0];
    const tail = this.messages.slice(-6);
    const middle = this.messages.slice(1, -6);

    // Build summary of compacted messages
    const summary = [];
    for (const m of middle) {
      if (m.role === 'user') summary.push(`User: ${(m.content || '').slice(0, 100)}`);
      else if (m.role === 'assistant' && m.content) summary.push(`Assistant: ${m.content.slice(0, 150)}`);
      else if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) summary.push(`Tool: ${tc.function.name}(${tc.function.arguments.slice(0, 60)})`);
      }
      // Skip tool results in summary (they're verbose)
    }

    const compactedMsg = {
      role: 'user',
      content: `[CONTEXT COMPACTED — ${middle.length} messages summarized]\n\nPrevious conversation summary:\n${summary.join('\n')}\n\n[Continue from here]`
    };

    this.messages = [system, compactedMsg, ...tail];
  }

  // #2 Async bash with spawn (cancellable)
  _execBashAsync(command, timeout) {
    return new Promise(resolve => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
      const args = process.platform === 'win32' ? ['/c', command] : ['-c', command];
      let stdout = '', stderr = '';
      const proc = spawn(shell, args, { cwd: this.projectRoot, timeout: timeout || 30000 });
      this.activeProcess = proc;

      proc.stdout.on('data', d => { stdout += d.toString(); if (stdout.length > 10000) stdout = stdout.slice(-10000); });
      proc.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 5000) stderr = stderr.slice(-5000); });

      const timer = setTimeout(() => { proc.kill('SIGTERM'); resolve({ success: false, output: 'Timeout exceeded', exitCode: -1 }); }, timeout || 30000);

      proc.on('close', code => {
        clearTimeout(timer);
        this.activeProcess = null;
        if (this.aborted) { resolve({ success: false, output: 'Aborted by user' }); return; }
        resolve({ success: code === 0, output: (stdout + (stderr ? '\n' + stderr : '')).slice(0, 10000), exitCode: code });
      });

      proc.on('error', err => {
        clearTimeout(timer);
        this.activeProcess = null;
        resolve({ success: false, output: err.message });
      });
    });
  }

  async _runSubagent(task, context, preset) {
    let subResult = '';
    const subSession = new AgentSession({
      provider: this.provider, model: this.model, projectRoot: this.projectRoot,
      onEvent: (evt) => {
        if (evt.type === 'message' && evt.role === 'assistant') subResult += (evt.content || '') + '\n';
        this.onEvent({ ...evt, subagent: true });
      },
      autoApprove: this.autoApprove, preset: preset || 'default'
    });
    const subPrompt = context ? `${task}\n\nContext:\n${context}` : task;
    try {
      await subSession.run(subPrompt);
      this.tokenUsage.input += subSession.tokenUsage.input;
      this.tokenUsage.output += subSession.tokenUsage.output;
      this.tokenUsage.total += subSession.tokenUsage.total;
    } catch (err) { subResult = `Subagent error: ${err.message}`; }
    return subResult.trim() || 'Subagent completed without output.';
  }

  // #1 Streaming LLM call — streams text tokens to frontend
  async _callLLMStreaming() {
    const baseUrl = (this.provider.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = new URL(baseUrl + '/chat/completions');
    const body = JSON.stringify({
      model: this.model || this.provider.defaultModel || 'gpt-4o',
      messages: this.messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: this.provider.maxTokens || 16384,
      stream: true
    });

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.provider.apiKey}`,
      ...(this.provider.customHeaders || {})
    };

    const mod = url.protocol === 'https:' ? https : http;
    this._streamedContent = false;

    return new Promise((resolve, reject) => {
      const req = mod.request(url.href, { method: 'POST', headers, timeout: 120000 }, res => {
        if (res.statusCode >= 400) {
          let errData = '';
          res.on('data', c => errData += c);
          res.on('end', () => {
            const err = new Error(`HTTP ${res.statusCode}: ${errData.slice(0, 300)}`);
            err.statusCode = res.statusCode;
            reject(err);
          });
          return;
        }

        let buffer = '';
        let content = '';
        let toolCalls = [];
        let usage = null;

        res.on('data', chunk => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) { if (parsed.usage) usage = parsed.usage; continue; }

              // Stream text content token-by-token
              if (delta.content) {
                content += delta.content;
                this._streamedContent = true;
                this.onEvent({ type: 'stream_token', content: delta.content });
              }

              // Accumulate tool calls
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (tc.index !== undefined) {
                    while (toolCalls.length <= tc.index) toolCalls.push({ id: '', function: { name: '', arguments: '' } });
                    if (tc.id) toolCalls[tc.index].id = tc.id;
                    if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
                    if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
                  }
                }
              }

              // Finish reason
              if (parsed.choices?.[0]?.finish_reason) {
                if (parsed.usage) usage = parsed.usage;
              }
            } catch {}
          }
        });

        res.on('end', () => {
          // If we streamed content, emit the full message event
          if (content) this.onEvent({ type: 'message', role: 'assistant', content });

          // Build response in non-streaming format
          const message = { role: 'assistant', content: content || null };
          if (toolCalls.length > 0) message.tool_calls = toolCalls;

          // Estimate usage if not provided
          if (!usage) {
            const inputTokens = countTokens(this.messages.map(m => m.content || '').join(''));
            const outputTokens = countTokens(content) + countTokens(toolCalls.map(t => t.function.arguments).join(''));
            usage = { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens };
          }

          resolve({ choices: [{ message }], usage });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('LLM timeout')); });
      req.write(body);
      req.end();
    });
  }
}

// ─── Export Conversation as Markdown (#10) ────────────────
function exportAsMarkdown(messages, tokenUsage, fileChanges) {
  let md = `# Agent Run Report\n\n`;
  md += `**Date:** ${new Date().toISOString()}\n`;
  md += `**Tokens:** ${tokenUsage.total} (in: ${tokenUsage.input}, out: ${tokenUsage.output})\n`;
  if (fileChanges.length) md += `**Files Changed:** ${fileChanges.length}\n`;
  md += '\n---\n\n';

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'user') md += `## User\n\n${msg.content}\n\n`;
    else if (msg.role === 'assistant') {
      if (msg.content) md += `## Assistant\n\n${msg.content}\n\n`;
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          md += `### Tool: ${tc.function.name}\n\n\`\`\`json\n${tc.function.arguments}\n\`\`\`\n\n`;
        }
      }
    } else if (msg.role === 'tool') {
      md += `> **Tool Output:**\n> \`\`\`\n> ${(msg.content || '').slice(0, 500).replace(/\n/g, '\n> ')}\n> \`\`\`\n\n`;
    }
  }

  if (fileChanges.length) {
    md += `## Files Changed\n\n`;
    for (const fc of fileChanges) md += `- \`${fc.path}\` (${fc.type})\n`;
  }

  return md;
}

module.exports = {
  AgentSession, PRESETS, listPresets, getPreset, estimateCost, countTokens,
  undoSession, getBackups, startWatcher, stopWatcher, exportAsMarkdown
};
