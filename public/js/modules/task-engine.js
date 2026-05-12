/**
 * Flowboard AI — Task Engine
 * State machine for task lifecycle + auto-movement
 */
const TaskEngine = (() => {
  // Valid transitions: from -> [to, ...]
  const TRANSITIONS = {
    'backlog':     ['ready'],
    'ready':       ['running', 'backlog'],
    'running':     ['review', 'done', 'needs-input', 'failed'],
    'needs-input': ['running', 'failed'],
    'review':      ['done', 'ready', 'needs-input'],
    'done':        [],
    'failed':      ['ready', 'backlog']
  };

  function canTransition(from, to) {
    return TRANSITIONS[from]?.includes(to) || false;
  }

  function getColumnForState(project, runState) {
    const map = { idle: 'backlog', queued: 'ready', running: 'running', paused: 'running', completed: 'done', failed: 'failed', 'needs-input': 'needs-input' };
    const type = map[runState] || 'backlog';
    return project.columns.find(c => c.type === type);
  }

  function moveTaskToColumn(project, task, targetType, log) {
    let sourceCol = null, sourceIdx = -1;
    for (const col of project.columns) {
      const idx = col.cards.findIndex(c => c.id === task.id);
      if (idx !== -1) { sourceCol = col; sourceIdx = idx; break; }
    }
    const targetCol = project.columns.find(c => c.type === targetType);
    if (!targetCol || !sourceCol || sourceCol.id === targetCol.id) return false;
    sourceCol.cards.splice(sourceIdx, 1);
    targetCol.cards.push(task);
    task.statusHistory.push({ from: sourceCol.type, to: targetType, ts: Date.now() });
    task.updatedAt = Date.now();
    if (log) addActivity(log, { type: 'move', taskId: task.id, taskTitle: task.title, from: sourceCol.title, to: targetCol.title });
    return true;
  }

  function startRun(project, task, log) {
    task.runState = 'running';
    task.lastRunAt = Date.now();
    task.executionHistory.push({ id: uid(), action: 'run_start', ts: Date.now(), status: 'running' });
    moveTaskToColumn(project, task, 'running', log);
    if (log) addActivity(log, { type: 'run_start', taskId: task.id, taskTitle: task.title });
  }

  function completeRun(project, task, output, needsReview, log) {
    task.outputSummary = output || '';
    task.runState = needsReview ? 'idle' : 'completed';
    task.executionHistory.push({ id: uid(), action: 'run_complete', ts: Date.now(), output: (output || '').slice(0, 500) });
    moveTaskToColumn(project, task, needsReview ? 'review' : 'done', log);
    if (log) addActivity(log, { type: 'run_complete', taskId: task.id, taskTitle: task.title, needsReview });
  }

  function failRun(project, task, error, log) {
    task.runState = 'failed';
    task.executionHistory.push({ id: uid(), action: 'run_failed', ts: Date.now(), error });
    moveTaskToColumn(project, task, 'failed', log);
    if (log) addActivity(log, { type: 'run_failed', taskId: task.id, taskTitle: task.title, error });
  }

  function requestInput(project, task, question, log) {
    task.runState = 'needs-input';
    task.executionHistory.push({ id: uid(), action: 'needs_input', ts: Date.now(), question });
    moveTaskToColumn(project, task, 'needs-input', log);
    if (log) addActivity(log, { type: 'needs_input', taskId: task.id, taskTitle: task.title, question });
  }

  function retryTask(project, task, log) {
    task.runState = 'idle';
    moveTaskToColumn(project, task, 'ready', log);
    if (log) addActivity(log, { type: 'retry', taskId: task.id, taskTitle: task.title });
  }

  function approveTask(project, task, log) {
    task.runState = 'completed';
    moveTaskToColumn(project, task, 'done', log);
    if (log) addActivity(log, { type: 'approved', taskId: task.id, taskTitle: task.title });
  }

  return { canTransition, getColumnForState, moveTaskToColumn, startRun, completeRun, failRun, requestInput, retryTask, approveTask };
})();
