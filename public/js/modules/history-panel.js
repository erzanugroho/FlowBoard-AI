/**
 * Flowboard AI — History Panel
 * Browse and search past chat threads & agent sessions
 */
const HistoryPanel = (() => {
  let items = [];
  let searchQuery = '';
  let loading = false;

  async function render(panelEl, opts) {
    const { projectPath, onOpenChat, onOpenAgent } = opts;
    if (!projectPath) {
      panelEl.innerHTML = '<div class="history-empty">Open a project first</div>';
      return;
    }

    panelEl.innerHTML = `
      <div class="history-panel">
        <div class="history-search">
          <input type="text" class="history-search-input" id="historySearchInput" placeholder="Search history..." value="${esc(searchQuery)}">
        </div>
        <div class="history-list" id="historyList">
          ${loading ? '<div class="history-loading">Loading...</div>' : ''}
        </div>
      </div>`;

    const input = panelEl.querySelector('#historySearchInput');
    let debounce = null;
    input?.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchQuery = input.value.trim();
        loadHistory(panelEl, opts);
      }, 300);
    });

    await loadHistory(panelEl, opts);
  }

  async function loadHistory(panelEl, opts) {
    const { projectPath, onOpenChat, onOpenAgent } = opts;
    const listEl = panelEl.querySelector('#historyList');
    if (!listEl) return;

    try {
      let data;
      if (searchQuery) {
        data = await apiPost('/api/history/search', { projectPath, query: searchQuery });
      } else {
        data = await apiPost('/api/history/list', { projectPath });
      }
      if (data.error) { listEl.innerHTML = `<div class="history-empty">${esc(data.error)}</div>`; return; }
      items = data.results || [];
    } catch (err) {
      items = [];
      listEl.innerHTML = `<div class="history-empty">Error: ${esc(err.message)}</div>`;
      return;
    }

    if (!items.length) {
      listEl.innerHTML = `<div class="history-empty">${searchQuery ? 'No results found' : 'No history yet'}</div>`;
      return;
    }

    listEl.innerHTML = items.map(item => `
      <div class="history-item" data-id="${esc(item.id)}" data-type="${item.type}">
        <div class="history-item-icon">${item.type === 'agent' ? Icons.get('zap', 14) : Icons.get('chat', 14)}</div>
        <div class="history-item-body">
          <div class="history-item-title">${esc(item.title || item.snippet || item.id)}</div>
          <div class="history-item-meta">
            <span class="history-type-badge history-type-${item.type}">${item.type}</span>
            ${item.messageCount ? `<span>${item.messageCount} msgs</span>` : ''}
            <span>${relativeTime(item.updatedAt)}</span>
          </div>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const type = el.dataset.type;
        if (type === 'chat') onOpenChat?.(id);
        else onOpenAgent?.(id);
      });
    });

    Icons.render(listEl);
  }

  return { render };
})();
