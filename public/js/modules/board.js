/**
 * Flowboard AI — Board Module
 * Kanban board rendering, drag-drop, multi-select, bulk actions
 */
const Board = (() => {
  let selectedCards = new Set();
  let dragCardId = null, dragSourceColId = null;

  function render(project, boardEl, callbacks) {
    if (!project) return;
    boardEl.innerHTML = '';
    selectedCards.clear();
    updateBulkBar();

    project.columns.forEach(col => {
      const colDef = COLUMN_TYPES.find(ct => ct.type === col.type) || COLUMN_TYPES[0];
      const colEl = document.createElement('div');
      colEl.className = 'column';
      colEl.dataset.colId = col.id;
      colEl.dataset.colType = col.type;

      colEl.innerHTML = `
        <div class="column-header">
          <div class="column-header-left">
            <span class="column-dot" style="background:${colDef.color}"></span>
            <span class="column-title">${esc(col.title)}</span>
            <span class="column-count">${col.cards.length}</span>
          </div>
          <div class="column-actions">
            ${col.type !== 'done' && col.type !== 'failed' ? `<button class="col-action-btn" data-action="run-all" data-col="${col.id}" title="Run all tasks in column"><i data-lucide="play" style="width:12px;height:12px"></i></button>` : ''}
            <button class="col-action-btn" data-action="add" data-col="${col.id}" title="Add task">+</button>
          </div>
        </div>`;

      const body = document.createElement('div');
      body.className = 'column-body';
      body.dataset.colId = col.id;

      col.cards.forEach(card => {
        const cardEl = createCardElement(card, col, colDef, callbacks);
        body.appendChild(cardEl);
      });

      body.addEventListener('dragover', onBodyDragOver);
      body.addEventListener('dragleave', onBodyDragLeave);
      body.addEventListener('drop', e => onBodyDrop(e, project, callbacks));

      colEl.appendChild(body);
      boardEl.appendChild(colEl);
    });

    // Column action buttons
    boardEl.querySelectorAll('.col-action-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const colId = btn.dataset.col;
        if (action === 'add') callbacks.onAddTask?.(colId);
        else if (action === 'run-all') callbacks.onRunColumn?.(colId);
      });
    });
    Icons.render(boardEl);
  }

  function createCardElement(card, col, colDef, callbacks) {
    const el = document.createElement('div');
    el.className = 'task-card' + (card.runState === 'running' ? ' card-running' : '') + (card.runState === 'failed' ? ' card-failed' : '');
    el.dataset.cardId = card.id;
    el.dataset.colId = col.id;
    el.draggable = true;

    const originIcon = card.origin === 'ai' ? '<i data-lucide="bot" class="icon" style="width:12px;height:12px"></i>' : '<i data-lucide="user" class="icon" style="width:12px;height:12px"></i>';
    const stateClass = `state-${card.runState || 'idle'}`;
    const stateLabel = (card.runState || 'idle').replace('-', ' ');
    const priorityHtml = card.priority ? `<span class="priority-badge ${card.priority}">${card.priority}</span>` : '';
    const labelHtml = card.label ? `<span class="task-tag tag-${card.label}">${card.label}</span>` : '';
    const agentHtml = card.assignedAgent ? `<span class="card-agent" title="Agent">${esc(card.assignedAgent)}</span>` : '';

    el.innerHTML = `
      <div class="card-top-row">
        <span class="card-origin" title="${card.origin}">${originIcon}</span>
        <span class="card-state ${stateClass}">${stateLabel}</span>
        <div class="card-quick-actions">
          <button class="qact" data-act="ask" title="Ask AI"><i data-lucide="message-square" style="width:12px;height:12px"></i></button>
          <button class="qact" data-act="run" title="Run"><i data-lucide="play" style="width:12px;height:12px"></i></button>
          <button class="qact" data-act="detail" title="Details"><i data-lucide="more-horizontal" style="width:12px;height:12px"></i></button>
        </div>
      </div>
      <div class="task-card-title">${esc(card.title)}</div>
      ${card.description ? `<div class="task-card-desc">${esc(card.description)}</div>` : ''}
      <div class="task-card-footer">
        <div class="task-card-tags">${labelHtml}${priorityHtml}</div>
        ${agentHtml}
        <span class="task-card-time">${relativeTime(card.updatedAt || card.createdAt)}</span>
      </div>`;

    // Events
    el.addEventListener('click', e => {
      if (e.target.closest('.qact') || e.target.closest('.card-quick-actions')) return;
      if (e.ctrlKey || e.metaKey) {
        toggleSelect(card.id, el);
      } else if (!el.classList.contains('dragging')) {
        callbacks.onOpenDetail?.(col.id, card.id);
      }
    });

    el.querySelectorAll('.qact').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'ask') callbacks.onAskAI?.(card);
        else if (act === 'run') callbacks.onRunTask?.(card, col);
        else if (act === 'detail') callbacks.onOpenDetail?.(col.id, card.id);
      });
    });

    el.addEventListener('dragstart', e => {
      dragCardId = card.id;
      dragSourceColId = col.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragCardId = null;
      dragSourceColId = null;
      document.querySelectorAll('.drop-placeholder').forEach(p => p.remove());
      document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    });

    return el;
  }

  function toggleSelect(cardId, el) {
    if (selectedCards.has(cardId)) { selectedCards.delete(cardId); el.classList.remove('selected'); }
    else { selectedCards.add(cardId); el.classList.add('selected'); }
    updateBulkBar();
  }

  function updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    if (!bar) return;
    if (selectedCards.size > 0) {
      bar.classList.add('active');
      bar.querySelector('.bulk-count').textContent = `${selectedCards.size} selected`;
    } else {
      bar.classList.remove('active');
    }
  }

  function getSelectedIds() { return [...selectedCards]; }
  function clearSelection() { selectedCards.clear(); document.querySelectorAll('.task-card.selected').forEach(c => c.classList.remove('selected')); updateBulkBar(); }

  // Drag & drop
  function onBodyDragOver(e) {
    if (!dragCardId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const body = e.currentTarget;
    body.closest('.column').classList.add('drag-over');
    body.querySelectorAll('.drop-placeholder').forEach(p => p.remove());
    const cards = [...body.querySelectorAll('.task-card:not(.dragging)')];
    const ph = document.createElement('div');
    ph.className = 'drop-placeholder';
    let inserted = false;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { body.insertBefore(ph, c); inserted = true; break; }
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

  function onBodyDrop(e, project, callbacks) {
    if (!dragCardId) return;
    e.preventDefault();
    e.stopPropagation();
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
    body.closest('.column').classList.remove('drag-over');
    callbacks.onMoveCard?.(dragCardId, dragSourceColId, targetColId, idx);
  }

  return { render, getSelectedIds, clearSelection };
})();
