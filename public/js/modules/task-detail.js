/**
 * Flowboard AI — Task Detail Drawer
 */
const TaskDetail = (() => {
  function open(project, colId, cardId, panelEl, overlayEl, callbacks) {
    const col = project.columns.find(c => c.id === colId);
    const card = col?.cards.find(c => c.id === cardId);
    if (!card) return;

    const originIcon = card.origin === 'ai' ? '<i data-lucide="bot" style="width:14px;height:14px"></i> AI-generated' : '<i data-lucide="user" style="width:14px;height:14px"></i> Human-created';
    const stateClass = `state-${card.runState || 'idle'}`;

    panelEl.querySelector('.side-panel-header h2').textContent = card.title;
    panelEl.querySelector('.side-panel-body').innerHTML = `
      <div class="detail-section">
        <div class="detail-meta-row">
          <span class="detail-origin">${originIcon}</span>
          <span class="card-state ${stateClass}">${(card.runState || 'idle').replace('-', ' ')}</span>
          <span class="priority-badge ${card.priority}">${card.priority}</span>
        </div>
      </div>

      <div class="detail-section">
        <label>Description</label>
        <p class="detail-text">${esc(card.description) || '<em class="text-muted">No description</em>'}</p>
      </div>

      ${card.inputPrompt ? `<div class="detail-section">
        <label>Input Prompt</label>
        <pre class="detail-prompt">${esc(card.inputPrompt)}</pre>
      </div>` : ''}

      ${card.outputSummary ? `<div class="detail-section">
        <label>AI Output</label>
        <div class="detail-output">${card.outputSummary}</div>
      </div>` : ''}

      <div class="detail-section detail-grid">
        <div><label>Column</label><p>${esc(col.title)}</p></div>
        <div><label>Assignee</label><p>${esc(card.assignee) || '—'}</p></div>
        <div><label>Agent</label><p>${esc(card.assignedAgent) || '—'}</p></div>
        <div><label>Label</label><p>${card.label ? `<span class="task-tag tag-${card.label}">${card.label}</span>` : '—'}</p></div>
      </div>

      ${card.executionHistory.length ? `<div class="detail-section">
        <label>Execution History</label>
        <div class="detail-history">
          ${card.executionHistory.slice(-10).reverse().map(h => `
            <div class="history-entry">
              <span class="history-action">${esc(h.action)}</span>
              <span class="history-time">${relativeTime(h.ts)}</span>
              ${h.error ? `<span class="history-error">${esc(h.error)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      ${card.statusHistory.length ? `<div class="detail-section">
        <label>Status Timeline</label>
        <div class="detail-history">
          ${card.statusHistory.slice(-10).reverse().map(s => `
            <div class="history-entry"><span>${esc(s.from)} → ${esc(s.to)}</span><span class="history-time">${relativeTime(s.ts)}</span></div>
          `).join('')}
        </div>
      </div>` : ''}
    `;

    panelEl.querySelector('.side-panel-footer').innerHTML = `
      <div class="detail-actions-left">
        <button class="btn btn-danger btn-sm" id="detailDeleteBtn">Delete</button>
      </div>
      <div class="detail-actions-right">
        <button class="btn btn-secondary btn-sm" id="detailRetryBtn" ${card.runState !== 'failed' ? 'style="display:none"' : ''}>Retry</button>
        <button class="btn btn-secondary btn-sm" id="detailReviewBtn">→ Review</button>
        <button class="btn btn-secondary btn-sm" id="detailEditBtn">Edit</button>
        <button class="btn btn-accent btn-sm" id="detailAskBtn">Ask AI</button>
        <button class="btn btn-primary btn-sm" id="detailRunBtn">▶ Run</button>
      </div>
    `;

    overlayEl.classList.add('active');
    panelEl.classList.add('active');

    // Events
    panelEl.querySelector('#detailDeleteBtn').onclick = () => callbacks.onDelete?.(colId, cardId);
    panelEl.querySelector('#detailEditBtn').onclick = () => { close(panelEl, overlayEl); callbacks.onEdit?.(colId, cardId); };
    panelEl.querySelector('#detailRunBtn').onclick = () => callbacks.onRun?.(card, col);
    panelEl.querySelector('#detailAskBtn').onclick = () => callbacks.onAskAI?.(card);
    panelEl.querySelector('#detailRetryBtn').onclick = () => callbacks.onRetry?.(card);
    panelEl.querySelector('#detailReviewBtn').onclick = () => callbacks.onSendToReview?.(card);
  }

  function close(panelEl, overlayEl) {
    panelEl.classList.remove('active');
    overlayEl.classList.remove('active');
  }

  return { open, close };
})();
