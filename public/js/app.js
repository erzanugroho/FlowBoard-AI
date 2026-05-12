/**
 * Flowboard AI — Main Application Controller
 */
(function () {
  'use strict';

  let appState = loadAppSettings();
  let currentProject = null;
  let currentProjectPath = null;
  let currentScreen = 'projects';
  let providers = [];
  let confirmCb = null;
  let taskModalMode = 'add';
  let taskModalColumnId = null;
  let taskModalCardId = null;
  let folderCurrentPath = '';

  // === THEME ===
  function applyTheme(t) {
    if (t === 'auto') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    document.body.setAttribute('data-theme', t);
    appState.settings.theme = t;
    saveAppSettings(appState);
    const icon = document.getElementById('themeIcon');
    if (icon) icon.innerHTML = t === 'dark'
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }

  // === NAVIGATION ===
  function showScreen(name) {
    currentScreen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.toggle('active', i.dataset.nav === name));
    if (name === 'projects') renderProjects();
    else if (name === 'settings') renderSettings();
    else if (name === 'providers') renderProviders();
    else if (name === 'mission') renderMissionFull();
  }

  // === PROJECTS ===
  function renderProjects() {
    const c = document.getElementById('projects-container');
    const recent = appState.recentProjects || [];
    if (!recent.length) {
      c.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">${Icons.get('zap', 40)}</div>
        <h3>Welcome to Flowboard AI</h3>
        <p>Your AI-powered kanban that can read, write, and execute code.</p>
        <div class="empty-quickstart">
          <div class="quickstart-card" onclick="document.getElementById('openFolderBtn').click()">
            <span>${Icons.get('folderOpen', 24)}</span><strong>Open Project</strong><small>Select a folder to start</small>
          </div>
          <div class="quickstart-card" onclick="document.querySelector('[data-nav=providers]').click()">
            <span>${Icons.get('key', 24)}</span><strong>Add AI Provider</strong><small>Connect OpenAI, Claude, etc.</small>
          </div>
          <div class="quickstart-card" onclick="document.getElementById('shortcutModal').classList.add('active')">
            <span>${Icons.get('keyboard', 24)}</span><strong>Shortcuts</strong><small>Learn keyboard shortcuts</small>
          </div>
        </div>
      </div>`;
      return;
    }
    let html = '<div class="projects-grid">';
    recent.forEach(rp => {
      html += `<div class="project-card" data-path="${esc(rp.path)}">
        <div class="project-card-indicator" style="background:${rp.color || '#6366f1'}"></div>
        <div class="project-card-name">${esc(rp.name)}</div>
        <div class="project-card-desc">${esc(rp.path)}</div>
        <div class="project-card-meta">
          <span><i data-lucide="folder" style="width:12px;height:12px"></i> ${esc(rp.path.split(/[\\/]/).pop())}</span>
          <span>${relativeTime(rp.lastOpened)}</span>
        </div>
      </div>`;
    });
    html += '</div>';
    c.innerHTML = html;
    c.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', () => loadProject(card.dataset.path));
    });
    Icons.render(c);
  }

  async function loadProject(folderPath) {
    try {
      const resp = await apiPost('/api/project/load', { projectPath: folderPath });
      if (resp.state) {
        currentProject = resp.state;
      } else {
        const name = folderPath.split(/[\\/]/).pop() || 'Untitled';
        currentProject = createDefaultProject(name, folderPath);
        await saveCurrentProject();
      }
      currentProjectPath = folderPath;
      updateRecentProject(folderPath, currentProject.name, currentProject.color);

      document.getElementById('board-project-title').textContent = currentProject.name;
      document.getElementById('board-project-desc').textContent = currentProjectPath;
      showScreen('board');
      renderBoard();
      renderAIPanel();
      renderMCInline();
    } catch (err) {
      alert('Error loading project: ' + err.message);
    }
  }

  async function saveCurrentProject() {
    if (!currentProjectPath || !currentProject) return;
    currentProject.updatedAt = Date.now();
    await apiPost('/api/project/save', { projectPath: currentProjectPath, state: currentProject });
  }

  function updateRecentProject(path, name, color) {
    let recent = appState.recentProjects || [];
    recent = recent.filter(r => r.path !== path);
    recent.unshift({ path, name, color: color || '#6366f1', lastOpened: Date.now() });
    if (recent.length > 20) recent.length = 20;
    appState.recentProjects = recent;
    saveAppSettings(appState);
  }

  // === BOARD ===
  function renderBoard() {
    if (!currentProject) return;
    Board.render(currentProject, document.getElementById('board'), {
      onAddTask: (colId) => openTaskModal('add', colId),
      onOpenDetail: (colId, cardId) => openTaskDetail(colId, cardId),
      onMoveCard: (cardId, fromCol, toCol, idx) => { moveCard(cardId, fromCol, toCol, idx); },
      onRunTask: (card, col) => runTask(card),
      onAskAI: (card) => askAIAboutTask(card),
      onRunColumn: (colId) => runColumn(colId)
    });
  }

  function moveCard(cardId, fromCol, toCol, idx) {
    if (!currentProject) return;
    const src = currentProject.columns.find(c => c.id === fromCol);
    const tgt = currentProject.columns.find(c => c.id === toCol);
    if (!src || !tgt) return;
    const ci = src.cards.findIndex(c => c.id === cardId);
    if (ci === -1) return;
    const card = src.cards.splice(ci, 1)[0];
    if (idx < 0 || idx >= tgt.cards.length) tgt.cards.push(card);
    else tgt.cards.splice(idx, 0, card);
    card.updatedAt = Date.now();
    saveCurrentProject();
    renderBoard();
  }

  // === TASK ACTIONS ===
  async function runTask(card) {
    if (!currentProject) return;
    TaskEngine.startRun(currentProject, card, appState.activityLog);
    saveCurrentProject();
    saveAppSettings(appState);
    renderBoard();
    renderMCInline();

    // Use agent for execution if provider is configured
    const providerId = currentProject.defaultProviderId || appState.settings.defaultProviderId;
    const provider = providers.find(p => p.id === providerId);
    if (provider && (card.inputPrompt || card.description)) {
      try {
        const prompt = card.inputPrompt || card.description || card.title;
        const resp = await fetch('/api/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId,
            model: currentProject.defaultModel || provider.defaultModel,
            projectPath: currentProjectPath,
            prompt: `Task: ${card.title}\n\n${prompt}`
          })
        });

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastOutput = '';

        function readStream() {
          return reader.read().then(({ done, value }) => {
            if (done) {
              TaskEngine.completeRun(currentProject, card, lastOutput || 'Task completed.', true, appState.activityLog);
              saveCurrentProject(); saveAppSettings(appState); renderBoard(); renderMCInline();
              UI.toast(`"${card.title}" completed`, 'success'); UI.playSound('success'); UI.clearBadge();
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const evt = JSON.parse(line.slice(6));
                if (evt.type === 'message' && evt.role === 'assistant') lastOutput = evt.content;
                if (evt.type === 'error') {
                  TaskEngine.failRun(currentProject, card, evt.content, appState.activityLog);
                  saveCurrentProject(); saveAppSettings(appState); renderBoard(); renderMCInline();
                  UI.toast(`"${card.title}" failed`, 'error'); UI.playSound('error');
                  return;
                }
              } catch {}
            }
            return readStream();
          });
        }
        await readStream();
      } catch (err) {
        TaskEngine.failRun(currentProject, card, err.message, appState.activityLog);
      }
    } else {
      setTimeout(() => {
        TaskEngine.completeRun(currentProject, card, 'Task completed (no AI provider configured — manual review)', true, appState.activityLog);
        saveCurrentProject();
        saveAppSettings(appState);
        renderBoard();
        renderMCInline();
      }, 1500);
    }
    saveCurrentProject();
    saveAppSettings(appState);
    renderBoard();
    renderMCInline();
  }
  function runColumn(colId) {
    if (!currentProject) return;
    const col = currentProject.columns.find(c => c.id === colId);
    if (!col || !col.cards.length) return;
    col.cards.forEach(card => runTask(card));
  }

  function askAIAboutTask(card) {
    const aiPanel = document.getElementById('aiPanel');
    if (!aiPanel.classList.contains('active')) aiPanel.classList.add('active');

    // Switch to Agent tab
    aiPanel.querySelectorAll('.right-panel-tab').forEach(t => t.classList.remove('active'));
    aiPanel.querySelector('[data-panel-tab="agent"]')?.classList.add('active');
    document.getElementById('chatPanelContent').style.display = 'none';
    document.getElementById('agentPanelContent').style.display = '';

    // Reset and render agent with card context
    AgentPanel.reset();
    AgentPanel.setCard(card);
    AgentPanel.render(document.getElementById('agentPanelContent'), {
      providers,
      projectPath: currentProjectPath,
      card,
      onSave: () => saveCurrentProject()
    });

    // Pre-fill agent input
    const agentInput = document.querySelector('#agentInput');
    if (agentInput) {
      const prompt = card.inputPrompt || card.description || card.title;
      agentInput.value = prompt;
      agentInput.focus();
    }
  }

  // === TASK DETAIL ===
  function openTaskDetail(colId, cardId) {
    TaskDetail.open(currentProject, colId, cardId,
      document.getElementById('taskPanel'),
      document.getElementById('taskPanelOverlay'),
      {
        onDelete: (cid, tid) => { deleteTask(cid, tid); closeTaskPanel(); },
        onEdit: (cid, tid) => openTaskModal('edit', cid, tid),
        onRun: (card) => { closeTaskPanel(); runTask(card); },
        onAskAI: (card) => { closeTaskPanel(); askAIAboutTask(card); },
        onRetry: (card) => { TaskEngine.retryTask(currentProject, card, appState.activityLog); saveCurrentProject(); saveAppSettings(appState); closeTaskPanel(); renderBoard(); renderMCInline(); },
        onSendToReview: (card) => { TaskEngine.moveTaskToColumn(currentProject, card, 'review', appState.activityLog); saveCurrentProject(); saveAppSettings(appState); closeTaskPanel(); renderBoard(); renderMCInline(); }
      }
    );
  }

  function closeTaskPanel() {
    TaskDetail.close(document.getElementById('taskPanel'), document.getElementById('taskPanelOverlay'));
  }

  // === TASK MODAL ===
  function openTaskModal(mode, colId, cardId) {
    taskModalMode = mode;
    taskModalColumnId = colId;
    taskModalCardId = cardId || null;
    const m = document.getElementById('taskModal');
    document.getElementById('taskModalTitle').textContent = mode === 'add' ? 'Add Task' : 'Edit Task';
    document.getElementById('taskModalSave').textContent = mode === 'add' ? 'Add Task' : 'Save';
    document.getElementById('taskDeleteBtn').style.display = mode === 'edit' ? '' : 'none';

    // Reset origin buttons
    document.querySelectorAll('[data-origin]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-origin="human"]')?.classList.add('active');

    if (mode === 'edit') {
      const col = currentProject?.columns.find(c => c.id === colId);
      const card = col?.cards.find(c => c.id === cardId);
      if (card) {
        document.getElementById('taskTitleInput').value = card.title;
        document.getElementById('taskDescInput').value = card.description || '';
        document.getElementById('taskPromptInput').value = card.inputPrompt || '';
        document.getElementById('taskPriorityInput').value = card.priority;
        document.getElementById('taskLabelInput').value = card.label || '';
        document.getElementById('taskAssigneeInput').value = card.assignee || '';
        document.getElementById('taskAgentInput').value = card.assignedAgent || '';
        document.querySelectorAll('[data-origin]').forEach(b => b.classList.toggle('active', b.dataset.origin === card.origin));
      }
    } else {
      ['taskTitleInput','taskDescInput','taskPromptInput','taskAssigneeInput','taskAgentInput'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('taskPriorityInput').value = 'medium';
      document.getElementById('taskLabelInput').value = '';
    }
    m.classList.add('active');
    setTimeout(() => document.getElementById('taskTitleInput').focus(), 50);
  }

  function saveTask() {
    const title = document.getElementById('taskTitleInput').value.trim();
    if (!title) return;
    const origin = document.querySelector('[data-origin].active')?.dataset.origin || 'human';
    const data = {
      title,
      description: document.getElementById('taskDescInput').value.trim(),
      inputPrompt: document.getElementById('taskPromptInput').value.trim(),
      priority: document.getElementById('taskPriorityInput').value,
      label: document.getElementById('taskLabelInput').value,
      assignee: document.getElementById('taskAssigneeInput').value.trim(),
      assignedAgent: document.getElementById('taskAgentInput').value.trim(),
      origin,
      updatedAt: Date.now()
    };
    if (taskModalMode === 'add') {
      const col = currentProject.columns.find(c => c.id === taskModalColumnId);
      if (col) {
        col.cards.push(createTask(data));
        addActivity(appState.activityLog, { type: 'task_created', taskTitle: data.title });
      }
    } else {
      const col = currentProject.columns.find(c => c.id === taskModalColumnId);
      const card = col?.cards.find(c => c.id === taskModalCardId);
      if (card) Object.assign(card, data);
    }
    saveCurrentProject();
    saveAppSettings(appState);
    closeModal('taskModal');
    renderBoard();
    renderMCInline();
  }

  function deleteTask(colId, cardId) {
    if (!currentProject) return;
    const col = currentProject.columns.find(c => c.id === colId);
    if (col) col.cards = col.cards.filter(c => c.id !== cardId);
    saveCurrentProject();
    renderBoard();
  }

  // === AI PANEL ===
  function renderAIPanel() {
    const panel = document.getElementById('aiPanel');
    if (!panel) return;
    if (appState.settings.aiPanelOpen) panel.classList.add('active');
    else panel.classList.remove('active');

    // Tab switching
    panel.querySelectorAll('.right-panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.right-panel-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.panelTab;
        document.getElementById('chatPanelContent').style.display = target === 'chat' ? '' : 'none';
        document.getElementById('agentPanelContent').style.display = target === 'agent' ? '' : 'none';
      });
    });

    // Render Chat tab
    Chat.render(currentProject, document.getElementById('chatPanelContent'), providers, {
      onSave: () => saveCurrentProject(),
      onSuggestion: (text) => {
        const input = document.querySelector('#chatInput');
        if (input) { input.value = text; input.focus(); }
      },
      onRunSelected: () => {
        const ids = Board.getSelectedIds();
        if (!ids.length) return;
        ids.forEach(id => {
          for (const col of currentProject.columns) {
            const card = col.cards.find(c => c.id === id);
            if (card) { runTask(card); break; }
          }
        });
        Board.clearSelection();
      }
    });

    // Render Agent tab
    AgentPanel.render(document.getElementById('agentPanelContent'), {
      providers,
      projectPath: currentProjectPath,
      card: null,
      onSave: () => saveCurrentProject()
    });
  }

  // === MISSION CONTROL ===
  function renderMCInline() {
    MissionControl.render(appState.activityLog, document.getElementById('mcPanelInline'));
  }
  function renderMissionFull() {
    MissionControl.render(appState.activityLog, document.getElementById('mcFullContent'));
  }

  // === PROVIDERS ===
  async function loadProviders() {
    try { providers = await apiGet('/api/providers'); } catch { providers = []; }
  }
  async function renderProviders() {
    await loadProviders();
    Providers.renderSettings(document.getElementById('providersContent'), providers, {
      onRefresh: () => renderProviders()
    });
  }

  // === FOLDER BROWSER ===
  async function openFolderBrowser() {
    // Detect initial path for browser (process.env not available in browser)
    const isWin = navigator.platform?.includes('Win') || navigator.userAgent?.includes('Windows');
    folderCurrentPath = isWin ? 'C:\\' : '/';
    document.getElementById('folderPathInput').value = folderCurrentPath;
    document.getElementById('folderModal').classList.add('active');
    await browseTo(folderCurrentPath);
  }

  async function browseTo(dir) {
    folderCurrentPath = dir;
    document.getElementById('folderPathInput').value = dir;
    try {
      const resp = await apiPost('/api/browse', { path: dir });
      const list = document.getElementById('folderList');
      let html = '';
      if (resp.parent) {
        html += `<div class="folder-entry folder-parent" data-path="${esc(resp.parent)}"><i data-lucide="folder" style="width:14px;height:14px"></i> ..</div>`;
      }
      (resp.entries || []).forEach(e => {
        html += `<div class="folder-entry" data-path="${esc(e.path)}"><i data-lucide="folder" style="width:14px;height:14px"></i> ${esc(e.name)}</div>`;
      });
      list.innerHTML = html || '<div class="folder-empty">No subfolders</div>';
      list.querySelectorAll('.folder-entry').forEach(el => {
        el.addEventListener('click', () => browseTo(el.dataset.path));
      });
      Icons.render(list);
    } catch (err) {
      document.getElementById('folderList').innerHTML = `<div class="folder-empty">Error: ${esc(err.message)}</div>`;
    }
  }

  // === SETTINGS ===
  function renderSettings() {
    const c = document.getElementById('settings-content');
    c.innerHTML = `
      <div class="settings-page">
        <h1>Settings</h1>
        <div class="settings-section">
          <h3>Appearance</h3>
          <div class="setting-row"><div><div class="setting-label">Theme</div><div class="setting-desc">Switch between light and dark mode</div></div>
            <div class="radio-group"><button class="radio-btn${appState.settings.theme === 'light' ? ' active' : ''}" data-theme="light">Light</button><button class="radio-btn${appState.settings.theme === 'dark' ? ' active' : ''}" data-theme="dark">Dark</button><button class="radio-btn${appState.settings.theme === 'auto' ? ' active' : ''}" data-theme="auto">Auto</button></div></div>
        </div>
        <div class="settings-section">
          <h3>Data</h3>
          <div class="setting-row"><div><div class="setting-label">Storage</div><div class="setting-desc">Project data is saved in each project's .flowboard/ directory</div></div>
            <div class="save-status"><span class="save-dot"></span> File-based</div></div>
          <div class="setting-row"><div><div class="setting-label">Clear Recent Projects</div><div class="setting-desc">Remove all projects from the recent list</div></div>
            <button class="btn btn-danger btn-sm" id="clearRecentBtn">Clear</button></div>
        </div>
      </div>`;
    c.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => { applyTheme(b.dataset.theme); renderSettings(); }));
    document.getElementById('clearRecentBtn')?.addEventListener('click', () => {
      appState.recentProjects = [];
      saveAppSettings(appState);
      renderSettings();
    });
  }

  // === MODALS ===
  function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }
  function openConfirm(msg, cb) {
    document.getElementById('confirmMessage').textContent = msg;
    confirmCb = cb;
    document.getElementById('confirmModal').classList.add('active');
  }

  // === INIT ===
  async function init() {
    applyTheme(appState.settings.theme || 'dark');
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (appState.settings.theme === 'auto') applyTheme('auto');
    });
    await loadProviders();
    showScreen('projects');

    // Nav
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        const nav = item.dataset.nav;
        if (nav === 'board' && !currentProject) return;
        showScreen(nav);
      });
    });

    // Open folder
    document.getElementById('openFolderBtn')?.addEventListener('click', () => openFolderBrowser());
    document.getElementById('folderGoBtn')?.addEventListener('click', () => {
      const val = document.getElementById('folderPathInput').value.trim();
      if (val) browseTo(val);
    });
    document.getElementById('folderPathInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const val = e.target.value.trim(); if (val) browseTo(val); }
    });
    document.getElementById('folderSelectBtn')?.addEventListener('click', () => {
      if (folderCurrentPath) { closeModal('folderModal'); loadProject(folderCurrentPath); }
    });

    // Board buttons
    document.getElementById('backToProjects')?.addEventListener('click', () => { currentProject = null; currentProjectPath = null; showScreen('projects'); });
    document.getElementById('addTaskBtn')?.addEventListener('click', () => {
      if (currentProject?.columns.length) openTaskModal('add', currentProject.columns[0].id);
    });
    document.getElementById('toggleChatBtn')?.addEventListener('click', () => {
      appState.settings.aiPanelOpen = !appState.settings.aiPanelOpen;
      saveAppSettings(appState);
      const panel = document.getElementById('aiPanel');
      panel.classList.toggle('active');
      if (panel.classList.contains('active')) renderAIPanel();
    });

    document.getElementById('shortcutHintBtn')?.addEventListener('click', () => {
      document.getElementById('shortcutModal').classList.add('active');
    });

    // Task modal
    document.getElementById('taskModalSave')?.addEventListener('click', saveTask);
    document.getElementById('taskDeleteBtn')?.addEventListener('click', () => {
      openConfirm('Delete this task?', () => { deleteTask(taskModalColumnId, taskModalCardId); closeModal('taskModal'); });
    });
    document.querySelectorAll('[data-origin]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-origin]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Bulk actions
    document.getElementById('bulkRunBtn')?.addEventListener('click', () => {
      const ids = Board.getSelectedIds();
      ids.forEach(id => {
        for (const col of currentProject.columns) {
          const card = col.cards.find(c => c.id === id);
          if (card) { runTask(card); break; }
        }
      });
      Board.clearSelection();
    });
    document.getElementById('bulkClearBtn')?.addEventListener('click', () => Board.clearSelection());
    document.getElementById('bulkDeleteBtn')?.addEventListener('click', () => {
      const ids = Board.getSelectedIds();
      openConfirm(`Delete ${ids.length} tasks?`, () => {
        ids.forEach(id => {
          for (const col of currentProject.columns) {
            col.cards = col.cards.filter(c => c.id !== id);
          }
        });
        Board.clearSelection();
        saveCurrentProject();
        renderBoard();
      });
    });

    // Theme
    document.getElementById('themeToggle')?.addEventListener('click', () => applyTheme(appState.settings.theme === 'dark' ? 'light' : 'dark'));

    // Confirm
    document.getElementById('confirmOk')?.addEventListener('click', () => { if (confirmCb) confirmCb(); closeModal('confirmModal'); confirmCb = null; });

    // Close modals
    document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('active'); });
    });

    // Task panel
    document.getElementById('taskPanelOverlay')?.addEventListener('click', closeTaskPanel);
    document.getElementById('closePanelBtn')?.addEventListener('click', closeTaskPanel);

    // Search
    document.getElementById('boardSearch')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.task-card').forEach(card => {
        const title = card.querySelector('.task-card-title')?.textContent.toLowerCase() || '';
        card.style.display = !q || title.includes(q) ? '' : 'none';
      });
    });

    // Keyboard
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
        closeTaskPanel();
      }
      // ? or Ctrl+/ = show shortcuts
      if ((e.key === '?' && !e.ctrlKey && !isInputFocused()) || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        document.getElementById('shortcutModal').classList.add('active');
      }
      // Ctrl+K = command palette
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); UI.showPalette(); }
      // Ctrl+N = new task
      if (e.ctrlKey && e.key === 'n' && currentProject) {
        e.preventDefault();
        if (currentProject.columns.length) openTaskModal('add', currentProject.columns[0].id);
      }
      // Ctrl+O = open folder
      if (e.ctrlKey && e.key === 'o') { e.preventDefault(); openFolderBrowser(); }
      // Ctrl+B = toggle AI panel
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        appState.settings.aiPanelOpen = !appState.settings.aiPanelOpen;
        saveAppSettings(appState);
        const panel = document.getElementById('aiPanel');
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) renderAIPanel();
      }
      // / = focus search (when not in input)
      if (e.key === '/' && !e.ctrlKey && !isInputFocused() && currentScreen === 'board') {
        e.preventDefault();
        document.getElementById('boardSearch')?.focus();
      }
      // Ctrl+Shift+R = run selected
      if (e.ctrlKey && e.shiftKey && e.key === 'R' && currentProject) {
        e.preventDefault();
        const ids = Board.getSelectedIds();
        ids.forEach(id => {
          for (const col of currentProject.columns) {
            const card = col.cards.find(c => c.id === id);
            if (card) { runTask(card); break; }
          }
        });
        Board.clearSelection();
      }
    });

    function isInputFocused() {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }

    // Onboarding
    initOnboarding();

    // #3 Resizable AI panel
    UI.makeResizable('#aiPanelResize', '#aiPanel', 'left');

    // #13 Command palette
    UI.registerCommands([
      { icon: '<i data-lucide="sticky-note" style="width:16px;height:16px"></i>', label: 'New Task', shortcut: 'Ctrl+N', keywords: 'add create task card', action: () => { if (currentProject?.columns.length) openTaskModal('add', currentProject.columns[0].id); } },
      { icon: '<i data-lucide="folder-open" style="width:16px;height:16px"></i>', label: 'Open Project Folder', shortcut: 'Ctrl+O', keywords: 'open folder browse', action: () => openFolderBrowser() },
      { icon: '<i data-lucide="bot" style="width:16px;height:16px"></i>', label: 'Toggle AI Panel', shortcut: 'Ctrl+B', keywords: 'ai agent chat', action: () => { document.getElementById('toggleChatBtn')?.click(); } },
      { icon: '<i data-lucide="search" style="width:16px;height:16px"></i>', label: 'Search Tasks', shortcut: '/', keywords: 'find filter', action: () => { document.getElementById('boardSearch')?.focus(); } },
      { icon: '<i data-lucide="play" style="width:16px;height:16px"></i>', label: 'Run Selected Cards', shortcut: 'Ctrl+Shift+R', keywords: 'execute run', action: () => { document.getElementById('bulkRunBtn')?.click(); } },
      { icon: '<i data-lucide="sun-moon" style="width:16px;height:16px"></i>', label: 'Toggle Theme', keywords: 'dark light mode', action: () => applyTheme(appState.settings.theme === 'dark' ? 'light' : 'dark') },
      { icon: '<i data-lucide="settings" style="width:16px;height:16px"></i>', label: 'Settings', keywords: 'config preferences', action: () => showScreen('settings') },
      { icon: '<i data-lucide="key-round" style="width:16px;height:16px"></i>', label: 'AI Providers', keywords: 'api key model', action: () => showScreen('providers') },
      { icon: '<i data-lucide="keyboard" style="width:16px;height:16px"></i>', label: 'Keyboard Shortcuts', shortcut: '?', keywords: 'help keys', action: () => document.getElementById('shortcutModal').classList.add('active') },
      { icon: '<i data-lucide="activity" style="width:16px;height:16px"></i>', label: 'Mission Control', keywords: 'activity log', action: () => showScreen('mission') }
    ]);

    // #10 Context menu on cards
    document.addEventListener('contextmenu', e => {
      const card = e.target.closest('.task-card');
      if (!card) return;
      e.preventDefault();
      const cardId = card.dataset.cardId;
      const colId = card.dataset.colId;
      showContextMenu(e.clientX, e.clientY, cardId, colId);
    });

    // Mobile menu
    const mt = document.getElementById('menuToggle');
    if (window.innerWidth <= 1024 && mt) mt.style.display = '';
    mt?.addEventListener('click', () => document.getElementById('sidebar')?.classList.toggle('open'));
  }

  // ─── #10 Context Menu ──────────────────────────────────
  function showContextMenu(x, y, cardId, colId) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.id = 'ctxMenu';
    menu.innerHTML = `
      <div class="ctx-item" data-act="run"><i data-lucide="play" class="icon" style="width:14px;height:14px"></i> Run Task</div>
      <div class="ctx-item" data-act="ask"><i data-lucide="message-square" class="icon" style="width:14px;height:14px"></i> Ask AI</div>
      <div class="ctx-item" data-act="edit"><i data-lucide="pencil" class="icon" style="width:14px;height:14px"></i> Edit</div>
      <div class="ctx-item" data-act="rename"><i data-lucide="type" class="icon" style="width:14px;height:14px"></i> Rename</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-act="move-review"><i data-lucide="arrow-right" class="icon" style="width:14px;height:14px"></i> Move to Review</div>
      <div class="ctx-item" data-act="move-done"><i data-lucide="check" class="icon" style="width:14px;height:14px"></i> Move to Done</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" data-act="delete"><i data-lucide="trash-2" class="icon" style="width:14px;height:14px"></i> Delete</div>`;
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 250) + 'px';
    document.body.appendChild(menu);
    menu.querySelectorAll('.ctx-item').forEach(item => {
      item.addEventListener('click', () => {
        const act = item.dataset.act;
        const col = currentProject?.columns.find(c => c.id === colId);
        const card = col?.cards.find(c => c.id === cardId);
        if (!card) { hideContextMenu(); return; }
        if (act === 'run') runTask(card);
        else if (act === 'ask') askAIAboutTask(card);
        else if (act === 'edit') openTaskModal('edit', colId, cardId);
        else if (act === 'rename') inlineEditCard(cardId);
        else if (act === 'move-review') moveCardToColumn(cardId, colId, 'review');
        else if (act === 'move-done') moveCardToColumn(cardId, colId, 'done');
        else if (act === 'delete') { deleteTask(colId, cardId); renderBoard(); }
        hideContextMenu();
      });
    });
    setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 10);
    Icons.render(menu);
  }
  function hideContextMenu() { document.getElementById('ctxMenu')?.remove(); }

  function moveCardToColumn(cardId, fromColId, targetType) {
    if (!currentProject) return;
    const src = currentProject.columns.find(c => c.id === fromColId);
    const tgt = currentProject.columns.find(c => c.type === targetType);
    if (!src || !tgt) return;
    const idx = src.cards.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const card = src.cards.splice(idx, 1)[0];
    tgt.cards.push(card);
    card.updatedAt = Date.now();
    saveCurrentProject(); renderBoard();
    UI.toast(`Moved to ${tgt.title}`, 'success');
  }

  // ─── #9 Inline Edit ───────────────────────────────────
  function inlineEditCard(cardId) {
    const el = document.querySelector(`.task-card[data-card-id="${cardId}"] .task-card-title`);
    if (!el) return;
    const oldText = el.textContent;
    const input = document.createElement('input');
    input.className = 'inline-edit-input';
    input.value = oldText;
    el.replaceWith(input);
    input.focus(); input.select();
    function save() {
      const newText = input.value.trim() || oldText;
      for (const col of currentProject.columns) {
        const card = col.cards.find(c => c.id === cardId);
        if (card) { card.title = newText; card.updatedAt = Date.now(); break; }
      }
      saveCurrentProject(); renderBoard();
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { input.value = oldText; save(); } });
  }

  function initOnboarding() {
    const ONBOARD_KEY = 'flowboard_onboarded';
    if (localStorage.getItem(ONBOARD_KEY)) {
      document.getElementById('onboardingOverlay')?.remove();
      return;
    }

    const overlay = document.getElementById('onboardingOverlay');
    if (!overlay) return;

    let step = 0;
    const steps = overlay.querySelectorAll('.onboarding-step');
    const dots = overlay.querySelectorAll('.dot');

    function showStep(n) {
      steps.forEach((s, i) => s.style.display = i === n ? '' : 'none');
      dots.forEach((d, i) => d.classList.toggle('active', i === n));
      step = n;
    }

    function finish() {
      localStorage.setItem(ONBOARD_KEY, '1');
      overlay.style.animation = 'fadeIn .2s ease reverse forwards';
      setTimeout(() => overlay.remove(), 200);
    }

    overlay.querySelector('#onboardSkip')?.addEventListener('click', finish);
    overlay.querySelector('#onboardDone')?.addEventListener('click', finish);
    for (let i = 0; i < 5; i++) {
      overlay.querySelector(`#onboardNext${i}`)?.addEventListener('click', () => showStep(i + 1));
    }
  }

  init();
})();
