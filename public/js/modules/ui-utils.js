/**
 * Flowboard AI — UI Utilities
 * #1 Progress indicator, #2 Toasts, #3 Resizable panel, #5 Animations,
 * #11 Sound, #12 Favicon badge, #13 Command palette, #14 Typing indicator
 */
const UI = (() => {
  // ─── #2 Toast Notifications ─────────────────────────────
  let toastContainer = null;

  function toast(message, type = 'info', duration = 3500) {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }
    const icons = { success: '<i data-lucide="check-circle-2" style="width:16px;height:16px"></i>', error: '<i data-lucide="x-circle" style="width:16px;height:16px"></i>', info: '<i data-lucide="info" style="width:16px;height:16px"></i>', warning: '<i data-lucide="alert-triangle" style="width:16px;height:16px"></i>' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || ''}</span><span class="toast-msg">${message}</span>`;
    toastContainer.appendChild(el);
    if (window.lucide) lucide.createIcons({ nodes: [el] });
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
  }

  // ─── #3 Resizable Panel ─────────────────────────────────
  function makeResizable(handleSelector, panelSelector, direction = 'left') {
    const handle = document.querySelector(handleSelector);
    const panel = document.querySelector(panelSelector);
    if (!handle || !panel) return;

    let startX, startW;
    handle.addEventListener('mousedown', e => {
      startX = e.clientX;
      startW = panel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e) {
        const diff = direction === 'left' ? startX - e.clientX : e.clientX - startX;
        panel.style.width = Math.max(280, Math.min(700, startW + diff)) + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ─── #11 Sound Feedback ─────────────────────────────────
  function playSound(type) {
    if (localStorage.getItem('flowboard_sound') === 'off') return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.08;

    if (type === 'success') { osc.frequency.value = 880; osc.type = 'sine'; }
    else if (type === 'error') { osc.frequency.value = 220; osc.type = 'square'; }
    else { osc.frequency.value = 660; osc.type = 'sine'; }

    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.stop(ctx.currentTime + 0.2);
  }

  // ─── #12 Favicon Badge ──────────────────────────────────
  let originalTitle = document.title;
  let badgeCount = 0;

  function setFaviconBadge(count) {
    badgeCount = count;
    if (count > 0) document.title = `(${count}) ${originalTitle}`;
    else document.title = originalTitle;
  }

  function incrementBadge() { setFaviconBadge(badgeCount + 1); }
  function clearBadge() { setFaviconBadge(0); }

  // ─── #13 Command Palette ────────────────────────────────
  let paletteVisible = false;
  let paletteCommands = [];
  let paletteFiltered = [];
  let paletteIndex = 0;

  function registerCommands(commands) { paletteCommands = commands; }

  function showPalette() {
    paletteVisible = true;
    paletteFiltered = paletteCommands;
    paletteIndex = 0;
    renderPalette();
  }

  function hidePalette() {
    paletteVisible = false;
    const el = document.getElementById('commandPalette');
    if (el) el.remove();
  }

  function renderPalette() {
    let el = document.getElementById('commandPalette');
    if (!el) {
      el = document.createElement('div');
      el.id = 'commandPalette';
      el.className = 'cmd-palette-overlay';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="cmd-palette">
        <input class="cmd-input" id="cmdInput" placeholder="Type a command..." autofocus>
        <div class="cmd-list" id="cmdList">
          ${paletteFiltered.slice(0, 10).map((c, i) => `
            <div class="cmd-item ${i === paletteIndex ? 'active' : ''}" data-idx="${i}">
              <span class="cmd-icon">${c.icon || Icons.get('zap', 16)}</span>
              <span class="cmd-label">${c.label}</span>
              <span class="cmd-shortcut">${c.shortcut || ''}</span>
            </div>
          `).join('')}
        </div>
      </div>`;

    const input = el.querySelector('#cmdInput');
    input.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      paletteFiltered = paletteCommands.filter(c => c.label.toLowerCase().includes(q) || (c.keywords || '').includes(q));
      paletteIndex = 0;
      renderPaletteList();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { hidePalette(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, paletteFiltered.length - 1); renderPaletteList(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); renderPaletteList(); }
      if (e.key === 'Enter') { e.preventDefault(); executePaletteCommand(); }
    });
    el.addEventListener('click', e => { if (e.target === el) hidePalette(); });
    el.querySelectorAll('.cmd-item').forEach(item => {
      item.addEventListener('click', () => { paletteIndex = parseInt(item.dataset.idx); executePaletteCommand(); });
    });
    input.focus();
  }

  function renderPaletteList() {
    const list = document.getElementById('cmdList');
    if (!list) return;
    list.innerHTML = paletteFiltered.slice(0, 10).map((c, i) => `
      <div class="cmd-item ${i === paletteIndex ? 'active' : ''}" data-idx="${i}">
        <span class="cmd-icon">${c.icon || Icons.get('zap', 16)}</span>
        <span class="cmd-label">${c.label}</span>
        <span class="cmd-shortcut">${c.shortcut || ''}</span>
      </div>
    `).join('');
    list.querySelectorAll('.cmd-item').forEach(item => {
      item.addEventListener('click', () => { paletteIndex = parseInt(item.dataset.idx); executePaletteCommand(); });
    });
  }

  function executePaletteCommand() {
    const cmd = paletteFiltered[paletteIndex];
    hidePalette();
    if (cmd?.action) cmd.action();
  }

  // ─── #14 Typing Indicator ───────────────────────────────
  function createTypingIndicator() {
    return '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  }

  // ─── #1 Progress Indicator ──────────────────────────────
  function createProgressBar(current, max, label) {
    const pct = Math.round((current / max) * 100);
    return `<div class="agent-progress"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div><span class="progress-label">${label || `Step ${current}/${max}`}</span></div>`;
  }

  return { toast, makeResizable, playSound, setFaviconBadge, incrementBadge, clearBadge, registerCommands, showPalette, hidePalette, paletteVisible: () => paletteVisible, createTypingIndicator, createProgressBar };
})();
