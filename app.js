/**
 * Flowboard — Application Logic
 */
(function () {
  'use strict';
  let state = loadAppData();
  let currentProjectId = null;
  let currentScreen = 'projects';
  let taskModalMode = 'add';
  let taskModalColumnId = null;
  let taskModalCardId = null;
  let projectModalMode = 'add';
  let editingProjectId = null;
  let confirmCb = null;
  let dragCardId = null, dragSourceColId = null;

  // === THEME ===
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    state.settings.theme = t;
    saveAppData(state);
    const icon = document.getElementById('themeIcon');
    icon.innerHTML = t === 'dark'
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
    const titles = { projects: 'Projects', settings: 'Settings', recent: 'Recent', favorites: 'Favorites' };
    if (titles[name] !== undefined) document.getElementById('topbar-title').textContent = titles[name];
    if (name === 'projects') renderProjects();
    else if (name === 'settings') renderSettings();
  }

  // === PROJECTS DASHBOARD ===
  function renderProjects() {
    const c = document.getElementById('projects-container');
    if (!state.projects.length) {
      c.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <h3>No projects yet</h3>
        <p>Create your first project to start organizing tasks on a beautiful Kanban board.</p>
        <button class="btn btn-primary" onclick="document.getElementById('newProjectBtn').click()">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          Create First Project
        </button>
      </div>`;
      return;
    }
    let html = '<div class="projects-grid">';
    state.projects.forEach(p => {
      const tc = countTasks(p);
      html += `<div class="project-card" data-pid="${p.id}">
        <div class="project-card-indicator" style="background:${p.color}"></div>
        <div class="project-card-name">${esc(p.name)}</div>
        <div class="project-card-desc">${esc(p.description)}</div>
        <div class="project-card-meta">
          <span><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/></svg> ${tc} task${tc !== 1 ? 's' : ''}</span>
          <span><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg> ${relativeTime(p.updatedAt)}</span>
        </div>
      </div>`;
    });
    html += '</div>';
    c.innerHTML = html;
    c.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', () => openBoard(card.dataset.pid));
    });
  }

  // === KANBAN BOARD ===
  function openBoard(pid) {
    currentProjectId = pid;
    const p = state.projects.find(x => x.id === pid);
    if (!p) return;
    document.getElementById('board-project-title').textContent = p.name;
    document.getElementById('board-project-desc').textContent = p.description;
    document.getElementById('topbar-title').textContent = p.name;
    showScreen('board');
    renderBoard();
  }

  function renderBoard() {
    const p = state.projects.find(x => x.id === currentProjectId);
    if (!p) return;
    const board = document.getElementById('board');
    board.innerHTML = '';
    p.columns.forEach(col => {
      const colEl = document.createElement('div');
      colEl.className = 'column';
      colEl.dataset.colId = col.id;
      const dots = { 'Backlog': '#9ca3af', 'Todo': '#3b82f6', 'In Progress': '#f59e0b', 'Done': '#10b981' };
      const dotColor = dots[col.title] || p.color;
      colEl.innerHTML = `<div class="column-header">
        <div class="column-header-left">
          <span class="column-dot" style="background:${dotColor}"></span>
          <span class="column-title">${esc(col.title)}</span>
          <span class="column-count">${col.cards.length}</span>
        </div>
        <button class="column-add-btn" data-col="${col.id}" title="Add task">+</button>
      </div>`;
      const body = document.createElement('div');
      body.className = 'column-body';
      body.dataset.colId = col.id;
      col.cards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'task-card';
        cardEl.dataset.cardId = card.id;
        cardEl.dataset.colId = col.id;
        cardEl.draggable = true;
        let tagsHtml = '';
        if (card.label) tagsHtml += `<span class="task-tag tag-${card.label}">${card.label}</span>`;
        tagsHtml += `<span class="priority-badge ${card.priority}">${card.priority}</span>`;
        let dueHtml = card.due ? `<span class="task-card-due">${formatDate(card.due)}</span>` : '';
        cardEl.innerHTML = `<div class="task-card-title">${esc(card.title)}</div>
          ${card.description ? `<div class="task-card-desc">${esc(card.description)}</div>` : ''}
          <div class="task-card-footer"><div class="task-card-tags">${tagsHtml}</div>${dueHtml}</div>`;
        cardEl.addEventListener('click', (e) => { if (!cardEl.classList.contains('dragging')) openTaskPanel(col.id, card.id); });
        cardEl.addEventListener('dragstart', onCardDragStart);
        cardEl.addEventListener('dragend', onCardDragEnd);
        body.appendChild(cardEl);
      });
      body.addEventListener('dragover', onBodyDragOver);
      body.addEventListener('dragleave', onBodyDragLeave);
      body.addEventListener('drop', onBodyDrop);
      colEl.appendChild(body);
      board.appendChild(colEl);
    });
    board.querySelectorAll('.column-add-btn').forEach(btn => {
      btn.addEventListener('click', () => openTaskModal('add', btn.dataset.col));
    });
  }

  // === DRAG & DROP ===
  function onCardDragStart(e) {
    dragCardId = e.target.dataset.cardId;
    dragSourceColId = e.target.dataset.colId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  }
  function onCardDragEnd(e) {
    e.target.classList.remove('dragging');
    dragCardId = null; dragSourceColId = null;
    document.querySelectorAll('.drop-placeholder').forEach(p => p.remove());
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  }
  function onBodyDragOver(e) {
    if (!dragCardId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const body = e.currentTarget;
    body.closest('.column').classList.add('drag-over');
    body.querySelectorAll('.drop-placeholder').forEach(p => p.remove());
    const cards = Array.from(body.querySelectorAll('.task-card:not(.dragging)'));
    const ph = document.createElement('div');
    ph.className = 'drop-placeholder';
    let inserted = false;
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { body.insertBefore(ph, card); inserted = true; break; }
    }
    if (!inserted) body.appendChild(ph);
  }
  function onBodyDragLeave(e) {
    if (!dragCardId) return;
    const body = e.currentTarget;
    if (!body.contains(e.relatedTarget)) {
      body.closest('.column').classList.remove('drag-over');
      body.querySelectorAll('.drop-placeholder').forEach(p => p.remove());
    }
  }
  function onBodyDrop(e) {
    if (!dragCardId) return;
    e.preventDefault(); e.stopPropagation();
    const body = e.currentTarget;
    const targetColId = body.dataset.colId;
    const ph = body.querySelector('.drop-placeholder');
    let idx = -1;
    if (ph) {
      idx = 0;
      for (const child of body.children) {
        if (child === ph) break;
        if (child.classList.contains('task-card') && !child.classList.contains('dragging')) idx++;
      }
      ph.remove();
    }
    moveCard(dragCardId, dragSourceColId, targetColId, idx);
    body.closest('.column').classList.remove('drag-over');
  }
  function moveCard(cardId, fromCol, toCol, idx) {
    const p = state.projects.find(x => x.id === currentProjectId);
    if (!p) return;
    const src = p.columns.find(c => c.id === fromCol);
    const tgt = p.columns.find(c => c.id === toCol);
    if (!src || !tgt) return;
    const ci = src.cards.findIndex(c => c.id === cardId);
    if (ci === -1) return;
    const card = src.cards.splice(ci, 1)[0];
    if (idx < 0 || idx >= tgt.cards.length) tgt.cards.push(card);
    else tgt.cards.splice(idx, 0, card);
    p.updatedAt = Date.now();
    saveAppData(state);
    renderBoard();
  }

  // === TASK PANEL ===
  function openTaskPanel(colId, cardId) {
    const p = state.projects.find(x => x.id === currentProjectId);
    if (!p) return;
    const col = p.columns.find(c => c.id === colId);
    const card = col ? col.cards.find(c => c.id === cardId) : null;
    if (!card) return;
    document.getElementById('panelTaskTitle').textContent = card.title;
    const body = document.getElementById('panelBody');
    body.innerHTML = `
      <div class="form-group"><label>Description</label><p style="font-size:0.87rem;color:var(--text-secondary);line-height:1.6">${esc(card.description) || '<em style="color:var(--text-muted)">No description</em>'}</p></div>
      <div class="form-row"><div class="form-group"><label>Priority</label><span class="priority-badge ${card.priority}">${card.priority}</span></div>
      <div class="form-group"><label>Column</label><p style="font-size:0.87rem">${esc(col.title)}</p></div></div>
      <div class="form-row"><div class="form-group"><label>Due Date</label><p style="font-size:0.87rem">${card.due ? formatDate(card.due) : '—'}</p></div>
      <div class="form-group"><label>Assignee</label><p style="font-size:0.87rem">${esc(card.assignee) || '—'}</p></div></div>
      ${card.label ? `<div class="form-group"><label>Label</label><span class="task-tag tag-${card.label}">${card.label}</span></div>` : ''}`;
    document.getElementById('taskPanelOverlay').classList.add('active');
    document.getElementById('taskPanel').classList.add('active');
    document.getElementById('panelEditBtn').onclick = () => { closeTaskPanel(); openTaskModal('edit', colId, cardId); };
    document.getElementById('panelDeleteBtn').onclick = () => {
      openConfirm('Delete task "' + card.title + '"?', () => { deleteTask(colId, cardId); closeTaskPanel(); });
    };
  }
  function closeTaskPanel() {
    document.getElementById('taskPanelOverlay').classList.remove('active');
    document.getElementById('taskPanel').classList.remove('active');
  }

  // === TASK MODAL ===
  function openTaskModal(mode, colId, cardId) {
    taskModalMode = mode;
    taskModalColumnId = colId;
    taskModalCardId = cardId || null;
    const m = document.getElementById('taskModal');
    document.getElementById('taskModalTitle').textContent = mode === 'add' ? 'Add Task' : 'Edit Task';
    document.getElementById('taskModalSave').textContent = mode === 'add' ? 'Add Task' : 'Save Changes';
    document.getElementById('taskDeleteBtn').style.display = mode === 'edit' ? '' : 'none';
    if (mode === 'edit') {
      const p = state.projects.find(x => x.id === currentProjectId);
      const col = p ? p.columns.find(c => c.id === colId) : null;
      const card = col ? col.cards.find(c => c.id === cardId) : null;
      if (card) {
        document.getElementById('taskTitleInput').value = card.title;
        document.getElementById('taskDescInput').value = card.description || '';
        document.getElementById('taskPriorityInput').value = card.priority;
        document.getElementById('taskDueInput').value = card.due || '';
        document.getElementById('taskLabelInput').value = card.label || '';
        document.getElementById('taskAssigneeInput').value = card.assignee || '';
      }
    } else {
      document.getElementById('taskTitleInput').value = '';
      document.getElementById('taskDescInput').value = '';
      document.getElementById('taskPriorityInput').value = 'medium';
      document.getElementById('taskDueInput').value = '';
      document.getElementById('taskLabelInput').value = '';
      document.getElementById('taskAssigneeInput').value = '';
    }
    m.classList.add('active');
    setTimeout(() => document.getElementById('taskTitleInput').focus(), 50);
  }
  function saveTask() {
    const title = document.getElementById('taskTitleInput').value.trim();
    if (!title) { document.getElementById('taskTitleInput').style.borderColor = 'var(--accent-red)'; setTimeout(() => document.getElementById('taskTitleInput').style.borderColor = '', 1500); return; }
    const data = { title, description: document.getElementById('taskDescInput').value.trim(), priority: document.getElementById('taskPriorityInput').value, due: document.getElementById('taskDueInput').value, label: document.getElementById('taskLabelInput').value, assignee: document.getElementById('taskAssigneeInput').value.trim() };
    const p = state.projects.find(x => x.id === currentProjectId);
    if (!p) return;
    if (taskModalMode === 'add') {
      const col = p.columns.find(c => c.id === taskModalColumnId);
      if (col) col.cards.push({ id: uid(), ...data, createdAt: Date.now() });
    } else {
      const col = p.columns.find(c => c.id === taskModalColumnId);
      const card = col ? col.cards.find(c => c.id === taskModalCardId) : null;
      if (card) Object.assign(card, data);
    }
    p.updatedAt = Date.now();
    saveAppData(state);
    closeModal('taskModal');
    renderBoard();
  }
  function deleteTask(colId, cardId) {
    const p = state.projects.find(x => x.id === currentProjectId);
    if (!p) return;
    const col = p.columns.find(c => c.id === colId);
    if (col) col.cards = col.cards.filter(c => c.id !== cardId);
    p.updatedAt = Date.now();
    saveAppData(state);
    renderBoard();
  }

  // === PROJECT MODAL ===
  function openProjectModal(mode, pid) {
    projectModalMode = mode;
    editingProjectId = pid || null;
    document.getElementById('projectModalTitle').textContent = mode === 'add' ? 'New Project' : 'Edit Project';
    document.getElementById('projectModalSave').textContent = mode === 'add' ? 'Create Project' : 'Save';
    const opts = document.getElementById('projectColorOptions');
    let selColor = PROJECT_COLORS[0];
    if (mode === 'edit') {
      const p = state.projects.find(x => x.id === pid);
      if (p) { document.getElementById('projectNameInput').value = p.name; document.getElementById('projectDescInput').value = p.description; selColor = p.color; }
    } else {
      document.getElementById('projectNameInput').value = '';
      document.getElementById('projectDescInput').value = '';
    }
    opts.innerHTML = PROJECT_COLORS.map(c => `<div class="color-option${c === selColor ? ' selected' : ''}" style="background:${c}" data-color="${c}"></div>`).join('');
    opts.querySelectorAll('.color-option').forEach(o => {
      o.addEventListener('click', () => { opts.querySelectorAll('.color-option').forEach(x => x.classList.remove('selected')); o.classList.add('selected'); });
    });
    document.getElementById('projectModal').classList.add('active');
    setTimeout(() => document.getElementById('projectNameInput').focus(), 50);
  }
  function saveProject() {
    const name = document.getElementById('projectNameInput').value.trim();
    if (!name) { document.getElementById('projectNameInput').style.borderColor = 'var(--accent-red)'; setTimeout(() => document.getElementById('projectNameInput').style.borderColor = '', 1500); return; }
    const desc = document.getElementById('projectDescInput').value.trim();
    const colorEl = document.querySelector('#projectColorOptions .color-option.selected');
    const color = colorEl ? colorEl.dataset.color : PROJECT_COLORS[0];
    if (projectModalMode === 'add') {
      state.projects.push({ id: uid(), name, description: desc, color, updatedAt: Date.now(),
        columns: [
          { id: uid(), title: 'Backlog', cards: [] },
          { id: uid(), title: 'Todo', cards: [] },
          { id: uid(), title: 'In Progress', cards: [] },
          { id: uid(), title: 'Done', cards: [] }
        ]
      });
    } else {
      const p = state.projects.find(x => x.id === editingProjectId);
      if (p) { p.name = name; p.description = desc; p.color = color; p.updatedAt = Date.now(); }
    }
    saveAppData(state);
    closeModal('projectModal');
    renderProjects();
  }

  // === SETTINGS ===
  function renderSettings() {
    const c = document.getElementById('settings-content');
    c.innerHTML = `
      <h1 style="font-size:1.5rem;font-weight:700;margin-bottom:24px;letter-spacing:-0.03em">Settings</h1>
      <div class="settings-section">
        <h3>Appearance</h3>
        <div class="setting-row"><div><div class="setting-label">Theme</div><div class="setting-desc">Switch between light and dark mode</div></div>
          <div class="radio-group"><button class="radio-btn${state.settings.theme === 'light' ? ' active' : ''}" data-theme="light">Light</button><button class="radio-btn${state.settings.theme === 'dark' ? ' active' : ''}" data-theme="dark">Dark</button></div></div>
        <div class="setting-row"><div><div class="setting-label">Board Density</div><div class="setting-desc">Adjust spacing between cards</div></div>
          <div class="radio-group"><button class="radio-btn${state.settings.density === 'compact' ? ' active' : ''}" data-density="compact">Compact</button><button class="radio-btn${state.settings.density === 'comfortable' ? ' active' : ''}" data-density="comfortable">Comfortable</button></div></div>
      </div>
      <div class="settings-section">
        <h3>Data</h3>
        <div class="setting-row"><div><div class="setting-label">Autosave</div><div class="setting-desc">Changes are automatically saved to local storage</div></div>
          <div class="save-status"><span class="save-dot"></span> Active</div></div>
        <div class="setting-row"><div><div class="setting-label">Reset Data</div><div class="setting-desc">Restore sample data and clear all changes</div></div>
          <button class="btn btn-danger" id="resetDataBtn">Reset</button></div>
      </div>
      <div class="settings-section">
        <h3>Profile</h3>
        <div class="profile-placeholder"><div class="avatar avatar-lg">EN</div><div class="profile-info"><div class="name">Erza Nugroho</div><div class="email">erza@example.com</div></div></div>
      </div>`;
    c.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
      applyTheme(b.dataset.theme); renderSettings();
    }));
    c.querySelectorAll('[data-density]').forEach(b => b.addEventListener('click', () => {
      state.settings.density = b.dataset.density; saveAppData(state); renderSettings();
    }));
    const rb = document.getElementById('resetDataBtn');
    if (rb) rb.addEventListener('click', () => {
      openConfirm('Reset all data to sample defaults?', () => {
        localStorage.removeItem(STORAGE_KEY); state = loadAppData(); renderSettings(); renderProjects();
      });
    });
  }

  // === MODALS ===
  function closeModal(id) { document.getElementById(id).classList.remove('active'); }
  function openConfirm(msg, cb) {
    document.getElementById('confirmMessage').textContent = msg;
    confirmCb = cb;
    document.getElementById('confirmModal').classList.add('active');
  }

  // === UTIL ===
  function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // === SEARCH ===
  function filterBoard(query) {
    if (!query) { renderBoard(); return; }
    const q = query.toLowerCase();
    document.querySelectorAll('.task-card').forEach(card => {
      const title = card.querySelector('.task-card-title').textContent.toLowerCase();
      card.style.display = title.includes(q) ? '' : 'none';
    });
  }

  // === INIT ===
  function init() {
    applyTheme(state.settings.theme || 'light');
    showScreen('projects');

    // Nav
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        const nav = item.dataset.nav;
        if (nav === 'projects' || nav === 'settings') showScreen(nav);
        else if (nav === 'recent' || nav === 'favorites') showScreen('projects');
      });
    });

    // Buttons
    document.getElementById('newProjectBtn').addEventListener('click', () => openProjectModal('add'));
    document.getElementById('projectModalSave').addEventListener('click', saveProject);
    document.getElementById('taskModalSave').addEventListener('click', saveTask);
    document.getElementById('addTaskBtn').addEventListener('click', () => {
      const p = state.projects.find(x => x.id === currentProjectId);
      if (p && p.columns.length) openTaskModal('add', p.columns[0].id);
    });
    document.getElementById('backToProjects').addEventListener('click', () => showScreen('projects'));
    document.getElementById('themeToggle').addEventListener('click', () => {
      applyTheme(state.settings.theme === 'dark' ? 'light' : 'dark');
    });

    // Task delete from modal
    document.getElementById('taskDeleteBtn').addEventListener('click', () => {
      openConfirm('Delete this task?', () => { deleteTask(taskModalColumnId, taskModalCardId); closeModal('taskModal'); });
    });

    // Confirm
    document.getElementById('confirmOk').addEventListener('click', () => { if (confirmCb) confirmCb(); closeModal('confirmModal'); confirmCb = null; });

    // Close modals
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('active'); });
    });

    // Task panel
    document.getElementById('taskPanelOverlay').addEventListener('click', closeTaskPanel);
    document.getElementById('closePanelBtn').addEventListener('click', closeTaskPanel);
    document.getElementById('panelCloseBtn').addEventListener('click', closeTaskPanel);

    // Search
    document.getElementById('boardSearch').addEventListener('input', (e) => filterBoard(e.target.value));
    document.getElementById('globalSearch').addEventListener('input', (e) => {
      if (currentScreen === 'projects') {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.project-card').forEach(card => {
          const name = card.querySelector('.project-card-name').textContent.toLowerCase();
          card.style.display = name.includes(q) ? '' : 'none';
        });
      }
    });

    // Mobile menu
    const mt = document.getElementById('menuToggle');
    if (window.innerWidth <= 1024) mt.style.display = '';
    mt.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
        closeTaskPanel();
      }
    });
  }

  init();
})();