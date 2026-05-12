/**
 * Flowboard AI — Agent Panel (v2)
 * All 14 improvements integrated:
 * #1 Auto-approve toggle, #2 Persistence, #3 Context injection (server-side),
 * #4 Streaming display, #5 Multi-turn, #6 Diff viewer, #7 Token usage,
 * #8 Retry, #9 Parallel (via runColumn), #10 MCP, #11 Keyboard shortcuts,
 * #12 File watcher, #13 Cost estimation, #14 Presets
 */
const AgentPanel = (() => {
  let activeSessionId = null;
  let messages = [];
  let isRunning = false;
  let pendingApproval = null;
  let autoApprove = false;
  let selectedPreset = 'default';
  let selectedSkill = '';
  let selectedModelValue = ''; // persist model selection across re-renders
  let tokenUsage = { input: 0, output: 0, total: 0 };
  let fileChanges = [];
  let currentCard = null;
  let currentOpts = null;
  let availableSkills = [];
  let sessionHistory = []; // saved past sessions

  function render(panelEl, opts) {
    currentOpts = opts;
    const { providers, projectPath, card } = opts;
    if (card && card !== currentCard) { currentCard = card; }
    const provList = (providers || []).filter(p => p.enabled !== false);

    // Load skills on first render
    if (availableSkills.length === 0) loadSkills();

    panelEl.innerHTML = `
      <div class="agent-panel">
        <div class="agent-header">
          <div class="agent-header-left">
            <span class="agent-icon">${Icons.get('zap', 18)}</span>
            <h3>Agent${currentCard ? ': ' + escHtml(currentCard.title) : ''}</h3>
          </div>
          <div class="agent-header-right">
            <select class="agent-model-select" id="agentModelSelect">
              <option value="">Model...</option>
              ${provList.map(p => {
                const models = (p.models && p.models.length) ? p.models : [p.defaultModel || 'default'];
                return models.map(m => `<option value="${p.id}::${m}">${escHtml(p.name)}/${escHtml(m)}</option>`).join('');
              }).join('')}
            </select>
            <select class="agent-preset-select" id="agentPresetSelect" title="Preset / Skill">
              <optgroup label="Presets">
                <option value="preset:default">Default</option>
                <option value="preset:bugfix">Bug Fix</option>
                <option value="preset:feature">Feature</option>
                <option value="preset:refactor">Refactor</option>
                <option value="preset:test">Test Writer</option>
              </optgroup>
              ${availableSkills.length > 0 ? `<optgroup label="Skills">
                ${availableSkills.map(s => `<option value="skill:${escHtml(s.name)}" title="${escHtml(s.description)}">${escHtml(s.name)}</option>`).join('')}
              </optgroup>` : ''}
            </select>
            <button class="btn-icon agent-abort-btn" id="agentAbortBtn" title="Abort (Ctrl+.)" style="display:${isRunning ? 'flex' : 'none'}">${Icons.get('stop', 14)}</button>
            <button class="btn-icon" id="agentNewBtn" title="New session">${Icons.get('plus', 14)}</button>
            <button class="btn-icon" id="agentHistoryBtn" title="Session history">${Icons.get('clock', 14)}</button>
          </div>
        </div>

        <!-- #1 Auto-approve + #7 Token usage bar -->
        <div class="agent-toolbar">
          <label class="agent-toggle" title="Auto-approve dangerous operations (Ctrl+Shift+A)">
            <input type="checkbox" id="agentAutoApprove" ${autoApprove ? 'checked' : ''}>
            <span>Auto-approve</span>
          </label>
          <span class="agent-progress"></span>
          <div class="agent-token-display" id="agentTokens">
            ${tokenUsage.total > 0 ? `<span class="token-badge">${Icons.get('tokens', 12)} ${tokenUsage.total}</span>` : ''}
          </div>
          ${fileChanges.length > 0 ? `<span class="file-changes-badge" title="Files modified">${Icons.get('fileChanged', 12)} ${fileChanges.length}</span>` : ''}
          ${!isRunning && fileChanges.length > 0 ? `<button class="btn-icon" id="agentUndoBtn" title="Undo last run">${Icons.get('retry', 12)}</button>` : ''}
          ${!isRunning && messages.length > 0 ? `<button class="btn-icon" id="agentExportBtn" title="Export as markdown">${Icons.get('file', 12)}</button>` : ''}
          ${!isRunning && messages.length > 6 ? `<button class="btn-icon" id="agentCompactBtn" title="Compact context">${Icons.get('columns', 12)}</button>` : ''}
        </div>

        <div class="agent-messages" id="agentMessages">
          ${messages.length === 0 ? renderEmpty() : renderMessages()}
          ${isRunning && !pendingApproval ? UI.createTypingIndicator() : ''}
        </div>

        ${pendingApproval ? (pendingApproval.type === 'ask_user' ? renderAskUserBar() : renderApprovalBar()) : ''}

        <div class="agent-input-area">
          <div class="agent-input-row">
            <textarea class="agent-input" id="agentInput" placeholder="${isRunning ? 'Agent working...' : 'Describe task... (Ctrl+Enter to send)'}" rows="2" ${isRunning ? 'disabled' : ''}></textarea>
            <div class="agent-input-actions">
              <button class="agent-send-btn" id="agentSendBtn" ${isRunning ? 'disabled' : ''} title="Send (Ctrl+Enter)">
                ${isRunning ? '<span class="agent-spinner"></span>' : Icons.get('send', 16)}
              </button>
              ${!isRunning && messages.length > 0 ? `<button class="agent-retry-btn" id="agentRetryBtn" title="Retry last (Ctrl+R)">${Icons.get('retry', 14)}</button>` : ''}
            </div>
          </div>
          <div class="agent-tools-hint">Type <kbd>/</kbd> for skills · bash · read_file · write_file · edit_file · grep · glob · ls</div>
        </div>
      </div>`;

    bindEvents(panelEl, opts);
    scrollBottom(panelEl);
    Icons.render(panelEl);
  }

  function renderEmpty() {
    return `<div class="agent-empty"><div class="agent-empty-icon">${Icons.get('bot', 32)}</div><p>Agent ready</p><p class="agent-empty-sub">Give a task — agent will plan, execute tools, and deliver.</p></div>`;
  }

  function renderMessages() {
    let html = '';
    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];
      switch (msg.type) {
        case 'message':
          html += msg.role === 'user'
            ? `<div class="agent-msg msg-user"><span class="msg-avatar">${Icons.get('user', 14)}</span><div class="msg-text">${escHtml(msg.content)}</div></div>`
            : `<div class="agent-msg msg-ai"><span class="msg-avatar">${Icons.get('bot', 14)}</span><div class="msg-text">${renderMd(msg.content)}</div></div>`;
          i++;
          break;

        case 'tool_start': {
          // Skip if next is tool_result for same tool
          const next = messages[i + 1];
          if (next && next.type === 'tool_result' && next.toolName === msg.toolName) { i++; continue; }
          html += `<div class="agent-tool-block tool-running"><div class="tool-header">${Icons.get('loading', 14, 'spin')} <strong>${escHtml(msg.toolName)}</strong></div><pre class="tool-args">${escHtml(formatArgs(msg.args))}</pre></div>`;
          i++;
          break;
        }

        case 'tool_result': {
          // Group consecutive tool_results with same toolName
          const group = [msg];
          while (i + 1 < messages.length && messages[i + 1].type === 'tool_result' && messages[i + 1].toolName === msg.toolName) {
            i++;
            group.push(messages[i]);
          }
          // Also skip preceding tool_start entries that were already consumed
          if (group.length > 1) {
            // Render as compact group
            const icon = group.every(g => g.result?.success) ? Icons.get('success', 14) : Icons.get('warning', 14);
            const cls = group.every(g => g.result?.success) ? 'tool-success' : 'tool-error';
            html += `<div class="agent-tool-block ${cls} tool-group"><div class="tool-header">${icon} <strong>${escHtml(msg.toolName)}</strong> <span class="tool-group-count">×${group.length}</span></div>
              <div class="tool-group-items" style="display:none">${group.map(g => `<div class="tool-group-item"><pre class="tool-args">${escHtml(formatArgs(g.args))}</pre><pre class="tool-output">${escHtml((g.result?.output || '').slice(0, 500))}</pre></div>`).join('')}</div></div>`;
          } else {
            // Single tool result
            const cls = msg.result?.success ? 'tool-success' : 'tool-error';
            const icon = msg.result?.success ? Icons.get('success', 14) : Icons.get('error', 14);
            const output = (msg.result?.output || '').slice(0, 2000);
            const isLong = output.split('\n').length > 5;
            const highlighted = highlightToolOutput(output, msg.toolName, msg.args);
            const diffHtml = msg.result?.diff ? renderDiff(msg.result.diff) : '';
            html += `<div class="agent-tool-block ${cls}">
              <div class="tool-header">${icon} <strong>${escHtml(msg.toolName)}</strong></div>
              <pre class="tool-args">${escHtml(formatArgs(msg.args))}</pre>
              ${diffHtml}
              <div class="tool-output-wrap">
                ${isLong ? '<button class="tool-output-toggle" onclick="this.nextElementSibling.classList.toggle(\'collapsed\');this.textContent=this.textContent===\'▼\'?\'▲\':\'▼\'">▼</button>' : ''}
                <pre class="tool-output ${isLong ? 'collapsed' : ''}">${highlighted}</pre>
              </div>
            </div>`;
          }
          i++;
          break;
        }

        case 'tool_denied':
          html += `<div class="agent-tool-block tool-denied">${Icons.get('lock', 14)} <strong>${escHtml(msg.toolName)}</strong> — denied</div>`;
          i++;
          break;

        case 'approval_request':
          html += `<div class="agent-tool-block tool-pending"><div class="tool-header">${Icons.get('shield', 14)} <strong>${escHtml(msg.toolName)}</strong> needs approval</div><pre class="tool-args">${escHtml(formatArgs(msg.args))}</pre></div>`;
          i++;
          break;

        case 'error':
          html += `<div class="agent-msg msg-error">${Icons.get('error', 14)} ${escHtml(msg.content)}</div>`;
          i++;
          break;

        default:
          i++;
          break;
      }
    }
    return html;
  }

  // #6 Diff viewer
  function renderDiff(diff) {
    if (!diff || !diff.hunks || diff.hunks.length === 0) return '';
    const lines = diff.hunks.map(h => {
      if (h.startsWith('+')) return `<span class="diff-add">${escHtml(h)}</span>`;
      if (h.startsWith('-')) return `<span class="diff-del">${escHtml(h)}</span>`;
      return escHtml(h);
    }).join('\n');
    return `<div class="diff-viewer"><div class="diff-title">${Icons.get('diff', 12)} ${escHtml(diff.file)} (${diff.totalChanges} changes)</div><pre class="diff-content">${lines}</pre></div>`;
  }

  function renderApprovalBar() {
    return `<div class="agent-approval-bar">
      <span class="approval-label">${Icons.get('shield', 14)} <strong>${escHtml(pendingApproval.toolName)}</strong></span>
      <pre class="approval-preview">${escHtml(formatArgs(pendingApproval.args).slice(0, 150))}</pre>
      <div class="approval-actions">
        <button class="btn btn-primary btn-sm" id="approveBtn">${Icons.get('check', 12)} Allow</button>
        <button class="btn btn-danger btn-sm" id="denyBtn">${Icons.get('x', 12)} Deny</button>
        <label class="agent-toggle-sm"><input type="checkbox" id="approveAutoCheck"> Auto-approve rest</label>
      </div>
    </div>`;
  }

  function renderAskUserBar() {
    const q = pendingApproval.question || '';
    const opts = pendingApproval.options;
    return `<div class="agent-approval-bar agent-ask-bar">
      <span class="approval-label">${Icons.get('chat', 14)} <strong>Agent asks:</strong> ${escHtml(q)}</span>
      <div class="approval-actions">
        ${opts && opts.length > 0
          ? opts.map((o, i) => `<button class="btn btn-sm btn-primary ask-option-btn" data-answer="${escHtml(o)}">${escHtml(o)}</button>`).join('')
          : `<input type="text" class="ask-input" id="askUserInput" placeholder="Type your answer..." style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--border)">
             <button class="btn btn-sm btn-primary" id="askUserSendBtn">${Icons.get('send', 12)}</button>`
        }
      </div>
    </div>`;
  }

  function bindEvents(panelEl, opts) {
    const input = panelEl.querySelector('#agentInput');
    const sendBtn = panelEl.querySelector('#agentSendBtn');
    const abortBtn = panelEl.querySelector('#agentAbortBtn');
    const retryBtn = panelEl.querySelector('#agentRetryBtn');
    const presetSelect = panelEl.querySelector('#agentPresetSelect');
    const autoCheck = panelEl.querySelector('#agentAutoApprove');

    // #11 Keyboard shortcuts
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !isRunning) { e.preventDefault(); startAgent(panelEl, opts); }
      // Tab to accept slash command suggestion
      if (e.key === 'Tab' && slashMenuVisible) { e.preventDefault(); acceptSlashSuggestion(input, panelEl, opts); }
      // Arrow keys for slash menu
      if (slashMenuVisible && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        slashMenuIndex += e.key === 'ArrowDown' ? 1 : -1;
        renderSlashMenu(panelEl);
      }
      // Escape to close slash menu
      if (e.key === 'Escape' && slashMenuVisible) { e.preventDefault(); hideSlashMenu(panelEl); }
    });
    // Slash command detection on input
    input?.addEventListener('input', () => handleSlashInput(input, panelEl, opts));
    sendBtn?.addEventListener('click', () => { if (!isRunning) startAgent(panelEl, opts); });
    abortBtn?.addEventListener('click', () => abortAgent(panelEl, opts));
    retryBtn?.addEventListener('click', () => retryAgent(panelEl, opts));
    panelEl.querySelector('#agentNewBtn')?.addEventListener('click', () => {
      // Save current session to history before reset
      if (messages.length > 1) {
        const title = messages.find(m => m.type === 'message' && m.role === 'user')?.content?.slice(0, 50) || 'Session';
        sessionHistory.unshift({ id: activeSessionId || Date.now(), title, messages: [...messages], tokenUsage: { ...tokenUsage }, ts: Date.now() });
        if (sessionHistory.length > 30) sessionHistory.length = 30;
        saveSessionHistory(opts);
      }
      reset();
      render(panelEl, opts);
    });
    presetSelect?.addEventListener('change', e => {
      const val = e.target.value;
      if (val.startsWith('skill:')) { selectedSkill = val.slice(6); selectedPreset = 'default'; }
      else { selectedPreset = val.replace('preset:', ''); selectedSkill = ''; }
    });
    if (presetSelect) presetSelect.value = selectedSkill ? `skill:${selectedSkill}` : `preset:${selectedPreset}`;
    autoCheck?.addEventListener('change', e => { autoApprove = e.target.checked; });

    // Persist model selection
    const modelSelect = panelEl.querySelector('#agentModelSelect');
    if (modelSelect) {
      if (selectedModelValue) modelSelect.value = selectedModelValue;
      modelSelect.addEventListener('change', () => { selectedModelValue = modelSelect.value; });
    }

    // Toggle collapsed tool blocks on click
    panelEl.querySelectorAll('.agent-tool-block').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.tool-output-toggle')) return;
        el.classList.toggle('collapsed');
        const items = el.querySelector('.tool-group-items');
        if (items) items.style.display = items.style.display === 'none' ? '' : 'none';
      });
    });

    // #5 Undo
    panelEl.querySelector('#agentUndoBtn')?.addEventListener('click', () => {
      if (!activeSessionId) return;
      fetch('/api/agent/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: activeSessionId }) })
        .then(r => r.json()).then(data => {
          if (data.success) { UI.toast('Reverted ' + (data.files?.length || 0) + ' file(s)', 'success'); fileChanges = []; render(panelEl, opts); }
          else UI.toast('Nothing to undo', 'warning');
        });
    });

    // #10 Export
    panelEl.querySelector('#agentExportBtn')?.addEventListener('click', () => {
      if (!activeSessionId) return;
      fetch('/api/agent/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: activeSessionId }) })
        .then(r => r.json()).then(data => {
          if (data.markdown) {
            const blob = new Blob([data.markdown], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'agent-run-' + Date.now() + '.md'; a.click();
            URL.revokeObjectURL(url);
            UI.toast('Exported', 'success');
          }
        });
    });

    // Compact context
    panelEl.querySelector('#agentCompactBtn')?.addEventListener('click', () => {
      if (!activeSessionId) return;
      fetch('/api/agent/compact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: activeSessionId }) })
        .then(r => r.json()).then(data => {
          if (data.ok) UI.toast(`Compacted: ${data.tokensBefore} -> ${data.tokensAfter} tokens (saved ${data.saved})`, 'success');
        });
    });

    // #14 Drag-drop file
    const inputArea = panelEl.querySelector('.agent-input-area');
    inputArea?.addEventListener('dragover', e => { e.preventDefault(); inputArea.classList.add('drag-over'); });
    inputArea?.addEventListener('dragleave', () => inputArea.classList.remove('drag-over'));
    inputArea?.addEventListener('drop', e => {
      e.preventDefault(); inputArea.classList.remove('drag-over');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0 && input) {
        for (const file of files) {
          const reader = new FileReader();
          reader.onload = () => {
            const content = reader.result;
            input.value += (input.value ? '\n\n' : '') + `[File: ${file.name}]\n\`\`\`\n${content.slice(0, 5000)}\n\`\`\``;
          };
          reader.readAsText(file);
        }
      }
    });

    // #9 Image paste
    input?.addEventListener('paste', e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          const reader = new FileReader();
          reader.onload = () => {
            // Store base64 for sending to multimodal models
            input.dataset.imageData = reader.result;
            input.value += (input.value ? '\n' : '') + '[Image attached]';
            UI.toast('Image attached', 'info');
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    });

    // Approval
    panelEl.querySelector('#approveBtn')?.addEventListener('click', () => {
      const autoRest = panelEl.querySelector('#approveAutoCheck')?.checked;
      if (autoRest) autoApprove = true;
      respondApproval(true, panelEl, opts);
    });
    panelEl.querySelector('#denyBtn')?.addEventListener('click', () => respondApproval(false, panelEl, opts));

    // Ask user handlers
    panelEl.querySelector('#askUserSendBtn')?.addEventListener('click', () => {
      const input = panelEl.querySelector('#askUserInput');
      if (input) respondAskUser(input.value || '', panelEl, opts);
    });
    panelEl.querySelector('#askUserInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const input = e.target; respondAskUser(input.value || '', panelEl, opts); }
    });
    panelEl.querySelectorAll('.ask-option-btn').forEach(btn => {
      btn.addEventListener('click', () => respondAskUser(btn.dataset.answer, panelEl, opts));
    });
  }

  // #11 Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (!currentOpts) return;
    // Ctrl+. = abort
    if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); if (isRunning) abortAgent(document.getElementById('agentPanelContent'), currentOpts); }
    // Ctrl+Shift+A = toggle auto-approve
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') { e.preventDefault(); autoApprove = !autoApprove; const el = document.getElementById('agentPanelContent'); if (el) render(el, currentOpts); }
    // Ctrl+R in agent context = retry
    if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !isRunning && messages.length > 0) {
      const agentPanel = document.getElementById('agentPanelContent');
      if (agentPanel && agentPanel.style.display !== 'none') { e.preventDefault(); retryAgent(agentPanel, currentOpts); }
    }
  });

  function startAgent(panelEl, opts) {
    if (isRunning) return;
    const input = panelEl.querySelector('#agentInput');
    let text = input?.value?.trim();
    if (!text) return;
    hideSlashMenu(panelEl);

    // Parse /skill command from text
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const cmd = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
      const rest = spaceIdx > 0 ? text.slice(spaceIdx + 1).trim() : '';
      // Check if it's a valid skill/preset
      const matchedSkill = availableSkills.find(s => s.name === cmd);
      const presets = ['default', 'bugfix', 'feature', 'refactor', 'test'];
      if (matchedSkill) { selectedSkill = cmd; selectedPreset = 'default'; text = rest || `Use the ${cmd} skill for this task.`; }
      else if (presets.includes(cmd)) { selectedPreset = cmd; selectedSkill = ''; text = rest || `Use the ${cmd} approach.`; }
    }

    const modelSelect = panelEl.querySelector('#agentModelSelect');
    const [providerId, model] = (selectedModelValue || modelSelect?.value || '').split('::');
    if (!providerId) { messages.push({ type: 'error', content: 'Select a model first.' }); render(panelEl, opts); return; }

    input.value = '';
    isRunning = true;
    messages.push({ type: 'message', role: 'user', content: text });
    render(panelEl, opts);

    fetchSSE('/api/agent/run', {
      providerId, model, projectPath: opts.projectPath, prompt: text,
      sessionId: activeSessionId, autoApprove, preset: selectedPreset,
      skill: selectedSkill || undefined
    }, panelEl, opts);
  }

  // #8 Retry
  function retryAgent(panelEl, opts) {
    const lastError = messages.filter(m => m.type === 'error').pop();
    const [providerId, model] = (selectedModelValue || '').split('::');
    if (!providerId) return;

    isRunning = true;
    render(panelEl, opts);

    fetchSSE('/api/agent/retry', {
      providerId, model, projectPath: opts.projectPath,
      sessionId: activeSessionId, autoApprove, preset: selectedPreset,
      errorContext: lastError?.content || 'Previous attempt failed'
    }, panelEl, opts);
  }

  function fetchSSE(url, body, panelEl, opts) {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => {
            messages.push({ type: 'error', content: err.error || `HTTP ${response.status}` });
            isRunning = false; render(panelEl, opts);
          });
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function read() {
          reader.read().then(({ done, value }) => {
            if (done) { isRunning = false; pendingApproval = null; render(panelEl, opts); saveHistory(opts); return; }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try { handleEvent(JSON.parse(line.slice(6)), panelEl, opts); } catch {}
            }
            read();
          });
        }
        read();
      })
      .catch(err => { messages.push({ type: 'error', content: err.message }); isRunning = false; render(panelEl, opts); });
  }

  function handleEvent(evt, panelEl, opts) {
    switch (evt.type) {
      case 'session_start': activeSessionId = evt.sessionId; break;
      case 'message': case 'tool_start': case 'tool_result': case 'tool_denied': case 'error':
        // Skip user messages from server — already added locally before fetchSSE
        if (evt.type === 'message' && evt.role === 'user') break;
        clearStreamBuffer(panelEl);
        messages.push(evt);
        if (evt.type === 'error') { UI.toast(evt.content, 'error'); UI.playSound('error'); }
        render(panelEl, opts);
        break;
      case 'approval_request':
        messages.push(evt);
        pendingApproval = evt;
        render(panelEl, opts);
        break;
      case 'skill_detected':
        messages.push({ type: 'message', role: 'assistant', content: `Auto-selected skill: **${evt.skill}**` });
        render(panelEl, opts);
        break;
      case 'ask_user':
        messages.push(evt);
        pendingApproval = { type: 'ask_user', question: evt.question, options: evt.options, callId: evt.callId };
        render(panelEl, opts);
        break;
      case 'user_answer':
        pendingApproval = null;
        messages.push({ type: 'message', role: 'user', content: evt.answer });
        render(panelEl, opts);
        break;
      case 'subagent_start':
        messages.push({ type: 'message', role: 'assistant', content: `Spawning subagent: ${evt.task}` });
        render(panelEl, opts);
        break;
      case 'subagent_done':
        messages.push({ type: 'message', role: 'assistant', content: `Subagent completed.` });
        render(panelEl, opts);
        break;
      case 'briefing_loaded':
        messages.push({ type: 'message', role: 'assistant', content: `Loaded briefing: **${evt.briefing}**` });
        render(panelEl, opts);
        break;
      case 'token_usage':
        tokenUsage = evt.usage;
        render(panelEl, opts);
        break;
      case 'progress':
        // Update progress indicator without full re-render
        const progEl = panelEl.querySelector('.agent-progress');
        if (progEl) progEl.textContent = `Step ${evt.step}/${evt.maxSteps}`;
        break;
      case 'stream_token':
        // Append token to last message or create streaming buffer
        appendStreamToken(evt.content, panelEl);
        break;
      case 'retry_attempt':
        messages.push({ type: 'message', role: 'assistant', content: `Retrying (attempt ${evt.attempt})... ${evt.error}` });
        render(panelEl, opts);
        break;
      case 'compacted':
        messages.push({ type: 'message', role: 'assistant', content: `Context compacted: ${evt.tokensBefore} -> ${evt.tokensAfter} tokens` });
        render(panelEl, opts);
        break;
      case 'done':
        clearStreamBuffer(panelEl);
        if (evt.tokenUsage) tokenUsage = evt.tokenUsage;
        if (evt.fileChanges) fileChanges = evt.fileChanges;
        // #4 Multi-file diff summary
        if (fileChanges.length > 0) {
          messages.push({ type: 'message', role: 'assistant', content: `**${fileChanges.length} file(s) changed:** ${fileChanges.map(f => '`' + f.path + '`').join(', ')}` });
        }
        // #6 Track local stats
        trackStats(tokenUsage);
        isRunning = false; pendingApproval = null;
        render(panelEl, opts);
        UI.toast('Agent completed', 'success'); UI.playSound('success');
        break;
      case 'stream_end':
        if (evt.tokenUsage) tokenUsage = evt.tokenUsage;
        isRunning = false;
        render(panelEl, opts);
        saveHistory(opts);
        break;
      case 'aborted':
        isRunning = false;
        messages.push({ type: 'error', content: 'Aborted.' });
        render(panelEl, opts);
        break;
    }
  }

  function respondApproval(approved, panelEl, opts) {
    if (!pendingApproval || !activeSessionId) return;
    fetch('/api/agent/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: activeSessionId, callId: pendingApproval.callId, approved }) });
    pendingApproval = null;
    render(panelEl, opts);
  }

  function respondAskUser(answer, panelEl, opts) {
    if (!pendingApproval || !activeSessionId) return;
    fetch('/api/agent/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: activeSessionId, callId: pendingApproval.callId, answer }) });
    pendingApproval = null;
    render(panelEl, opts);
  }

  function abortAgent(panelEl, opts) {
    if (activeSessionId) fetch('/api/agent/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: activeSessionId }) });
    isRunning = false; pendingApproval = null;
    messages.push({ type: 'error', content: 'Aborted by user.' });
    render(panelEl, opts);
  }

  // #2 Persistence
  function saveHistory(opts) {
    if (!opts.projectPath || messages.length < 2) return;
    const cardId = currentCard?.id || activeSessionId || ('agent_' + Date.now().toString(36));
    fetch('/api/agent/history/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: opts.projectPath, cardId, messages, tokenUsage })
    });
  }

  async function loadHistory(opts, cardId) {
    const id = cardId || currentCard?.id;
    if (!id || !opts.projectPath) return;
    try {
      const resp = await fetch('/api/agent/history/load', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: opts.projectPath, cardId: id })
      });
      const data = await resp.json();
      if (data.messages && data.messages.length > 0) {
        messages = data.messages.filter(m => m.type);
        if (data.tokenUsage) tokenUsage = data.tokenUsage;
        const panelEl = document.getElementById('agentPanelContent');
        if (panelEl) render(panelEl, opts);
      }
    } catch {}
  }

  function reset() { messages = []; isRunning = false; pendingApproval = null; activeSessionId = null; tokenUsage = { input: 0, output: 0, total: 0 }; fileChanges = []; }

  function setCard(card) { currentCard = card; }

  // ─── Slash Commands ───────────────────────────────────
  let slashMenuVisible = false;
  let slashMenuIndex = 0;
  let slashFiltered = [];

  function handleSlashInput(input, panelEl, opts) {
    const val = input.value;
    // Detect /command at start of input
    if (val.startsWith('/')) {
      const query = val.slice(1).split(' ')[0].toLowerCase();
      slashFiltered = availableSkills.filter(s => s.name.toLowerCase().includes(query));
      // Also add built-in presets
      const presetItems = [
        { name: 'default', description: 'General coding assistant' },
        { name: 'bugfix', description: 'Diagnose and fix bugs' },
        { name: 'feature', description: 'Implement new features' },
        { name: 'refactor', description: 'Improve code quality' },
        { name: 'test', description: 'Write tests' }
      ].filter(p => p.name.includes(query));
      slashFiltered = [...presetItems.map(p => ({ ...p, isPreset: true })), ...slashFiltered];
      if (slashFiltered.length > 0) {
        slashMenuVisible = true;
        slashMenuIndex = Math.max(0, Math.min(slashMenuIndex, slashFiltered.length - 1));
        renderSlashMenu(panelEl);
      } else {
        hideSlashMenu(panelEl);
      }
    } else {
      hideSlashMenu(panelEl);
    }
  }

  function renderSlashMenu(panelEl) {
    let menu = panelEl.querySelector('.slash-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'slash-menu';
      const inputArea = panelEl.querySelector('.agent-input-area');
      if (inputArea) inputArea.insertBefore(menu, inputArea.firstChild);
    }
    menu.innerHTML = slashFiltered.slice(0, 8).map((s, i) => `
      <div class="slash-item ${i === slashMenuIndex ? 'active' : ''}" data-idx="${i}">
        <span class="slash-name">${s.isPreset ? Icons.get('settings', 12) : Icons.get('brain', 12)} /${escHtml(s.name)}</span>
        <span class="slash-desc">${escHtml((s.description || '').slice(0, 50))}</span>
      </div>
    `).join('');
    menu.style.display = '';
    menu.querySelectorAll('.slash-item').forEach(el => {
      el.addEventListener('click', () => {
        slashMenuIndex = parseInt(el.dataset.idx);
        acceptSlashSuggestion(panelEl.querySelector('#agentInput'), panelEl);
      });
    });
  }

  function hideSlashMenu(panelEl) {
    slashMenuVisible = false;
    const menu = panelEl.querySelector('.slash-menu');
    if (menu) menu.style.display = 'none';
  }

  function acceptSlashSuggestion(input, panelEl) {
    const item = slashFiltered[slashMenuIndex];
    if (!item) return;
    if (item.isPreset) { selectedPreset = item.name; selectedSkill = ''; }
    else { selectedSkill = item.name; selectedPreset = 'default'; }
    // Replace /command with empty or keep rest of text
    const val = input.value;
    const spaceIdx = val.indexOf(' ');
    input.value = spaceIdx > 0 ? val.slice(spaceIdx + 1) : '';
    hideSlashMenu(panelEl);
    // Update dropdown to reflect
    const select = panelEl.querySelector('#agentPresetSelect');
    if (select) select.value = item.isPreset ? `preset:${item.name}` : `skill:${item.name}`;
    input.focus();
  }

  function loadSkills() {
    fetch('/api/agent/presets').then(r => r.json()).then(data => {
      if (data.skills) availableSkills = data.skills;
    }).catch(() => {});
  }

  function trackStats(usage) {
    try {
      const app = JSON.parse(localStorage.getItem('flowboard-ai-app') || '{}');
      if (!app.stats) app.stats = { totalRuns: 0, totalTokens: 0, totalCost: 0, toolsUsed: {}, runsPerDay: {} };
      app.stats.totalRuns++;
      app.stats.totalTokens += usage.total || 0;
      const today = new Date().toISOString().slice(0, 10);
      app.stats.runsPerDay[today] = (app.stats.runsPerDay[today] || 0) + 1;
      localStorage.setItem('flowboard-ai-app', JSON.stringify(app));
    } catch {}
  }

  // Session history persistence
  function saveSessionHistory(opts) {
    if (!opts?.projectPath) return;
    try {
      fetch('/api/agent/sessions/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: opts.projectPath, sessions: sessionHistory })
      });
    } catch {}
  }

  async function loadSessionHistory(opts) {
    if (!opts?.projectPath) return;
    try {
      const resp = await fetch('/api/agent/sessions/load', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: opts.projectPath })
      });
      const data = await resp.json();
      if (data.sessions) sessionHistory = data.sessions;
    } catch {}
  }

  function showSessionHistory(panelEl, opts) {
    let menu = panelEl.querySelector('.session-history-menu');
    if (menu) { menu.remove(); return; }
    menu = document.createElement('div');
    menu.className = 'session-history-menu';
    if (sessionHistory.length === 0) {
      menu.innerHTML = '<div class="session-empty">No saved sessions</div>';
    } else {
      // Search box
      menu.innerHTML = `<input type="text" class="session-search" placeholder="Search sessions..." id="sessionSearchInput">
        <div class="session-list" id="sessionList">${renderSessionList(sessionHistory)}</div>`;
    }
    panelEl.querySelector('.agent-header').appendChild(menu);

    // Search filter
    menu.querySelector('#sessionSearchInput')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      const filtered = sessionHistory.filter(s => s.title.toLowerCase().includes(q));
      menu.querySelector('#sessionList').innerHTML = renderSessionList(filtered);
      bindSessionClicks(menu, panelEl, opts);
    });
    bindSessionClicks(menu, panelEl, opts);
  }

  function renderSessionList(sessions) {
    return sessions.map(s => `
      <div class="session-item" data-session-id="${s.id}">
        <div class="session-item-title">${escHtml(s.title)}</div>
        <div class="session-item-meta">${new Date(s.ts).toLocaleDateString()} — ${s.messages.length} msgs</div>
      </div>
    `).join('');
  }

  function bindSessionClicks(menu, panelEl, opts) {
    menu.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.sessionId;
        const session = sessionHistory.find(s => String(s.id) === id);
        if (session) {
          messages = [...session.messages];
          tokenUsage = session.tokenUsage || { input: 0, output: 0, total: 0 };
          activeSessionId = null;
          menu.remove();
          render(panelEl, opts);
        }
      });
    });
  }

  function scrollBottom(panelEl) {
    const el = panelEl.querySelector('#agentMessages');
    if (el) setTimeout(() => el.scrollTop = el.scrollHeight, 30);
  }

  // #1 Streaming token display
  let streamBuffer = '';
  function appendStreamToken(token, panelEl) {
    streamBuffer += token;
    let streamEl = panelEl.querySelector('.agent-stream-buffer');
    if (!streamEl) {
      const msgContainer = panelEl.querySelector('#agentMessages');
      if (!msgContainer) return;
      streamEl = document.createElement('div');
      streamEl.className = 'agent-msg msg-ai agent-stream-buffer';
      streamEl.innerHTML = `<span class="msg-avatar">${Icons.get('bot', 14)}</span><div class="msg-text"></div>`;
      msgContainer.appendChild(streamEl);
      Icons.render(streamEl);
    }
    streamEl.querySelector('.msg-text').innerHTML = renderMd(streamBuffer);
    scrollBottom(panelEl);
  }

  function clearStreamBuffer(panelEl) {
    streamBuffer = '';
    const el = panelEl.querySelector('.agent-stream-buffer');
    if (el) el.remove();
  }

  function formatArgs(args) { return JSON.stringify(args, null, 2); }
  function escHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function renderMd(text) {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${highlightSyntax(code)}</code></pre>`)
      .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${highlightSyntax(code)}</code></pre>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function highlightSyntax(code) {
    return code
      .replace(/\b(const|let|var|function|return|if|else|for|while|import|export|from|class|new|this|async|await|try|catch|throw|switch|case|break|default|typeof|instanceof)\b/g, '<span class="syn-kw">$1</span>')
      .replace(/(["'`])(?:(?!\1).)*?\1/g, '<span class="syn-str">$&</span>')
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="syn-num">$1</span>')
      .replace(/(\/\/.*)/g, '<span class="syn-cm">$1</span>')
      .replace(/(#.*)/g, '<span class="syn-cm">$1</span>');
  }

  // #13 Syntax highlight tool output based on file extension
  function highlightToolOutput(output, toolName, args) {
    if (toolName !== 'read_file' || !output) return escHtml(output);
    const ext = (args?.path || '').split('.').pop();
    const codeExts = ['js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','css','html','json','yaml','yml','toml','sh','bat'];
    if (codeExts.includes(ext)) return highlightSyntax(escHtml(output));
    return escHtml(output);
  }

  return { render, reset, setCard, loadHistory };
})();
