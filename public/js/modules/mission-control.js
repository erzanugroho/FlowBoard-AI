/**
 * Flowboard AI — Mission Control
 * Real-time activity feed with execution observability
 */
const MissionControl = (() => {
  function render(log, panelEl) {
    if (!panelEl) return;
    const entries = (log || []).slice(0, 50);
    panelEl.innerHTML = `
      <div class="mc-header">
        <h3>Mission Control</h3>
        <span class="mc-badge">${entries.length} events</span>
      </div>
      <div class="mc-feed" id="mcFeed">
        ${entries.length === 0 ? '<div class="mc-empty">No activity yet</div>' : entries.map(e => renderEntry(e)).join('')}
      </div>`;
  }

  function renderEntry(e) {
    const icons = {
      'run_start': Icons.get('play', 14),
      'run_complete': Icons.get('success', 14),
      'run_failed': Icons.get('error', 14),
      'needs_input': Icons.get('chat', 14),
      'retry': Icons.get('retry', 14),
      'approved': Icons.get('check', 14),
      'move': Icons.get('move', 14),
      'task_created': Icons.get('plus', 14),
      'chat': Icons.get('agent', 14)
    };
    const icon = icons[e.type] || Icons.get('activity', 14);
    const desc = getDescription(e);
    return `<div class="mc-entry mc-${e.type}">
      <span class="mc-icon">${icon}</span>
      <div class="mc-entry-body">
        <span class="mc-desc">${desc}</span>
        <span class="mc-time">${relativeTime(e.ts)}</span>
      </div>
    </div>`;
  }

  function getDescription(e) {
    const t = esc(e.taskTitle || '');
    switch (e.type) {
      case 'run_start': return `Started execution: <strong>${t}</strong>`;
      case 'run_complete': return `Completed: <strong>${t}</strong>${e.needsReview ? ' → Review' : ' → Done'}`;
      case 'run_failed': return `Failed: <strong>${t}</strong> — ${esc(e.error || '')}`;
      case 'needs_input': return `Waiting for input: <strong>${t}</strong>`;
      case 'retry': return `Retrying: <strong>${t}</strong>`;
      case 'approved': return `Approved: <strong>${t}</strong>`;
      case 'move': return `Moved <strong>${t}</strong>: ${esc(e.from)} → ${esc(e.to)}`;
      case 'task_created': return `Created task: <strong>${t}</strong>`;
      case 'chat': return `AI chat: ${esc(e.message || '')}`;
      default: return e.type;
    }
  }

  return { render };
})();
