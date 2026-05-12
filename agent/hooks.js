/**
 * Flowboard AI — Lifecycle Hooks & Briefings
 * 
 * Hooks: beforeRun, afterToolExecution, onError, afterRun
 * Briefings: Pre-loaded context scenarios from .flowboard/briefings/
 */
const fs = require('fs');
const path = require('path');

const FLOWBOARD_DIR = '.flowboard';

// ─── Lifecycle Hooks ─────────────────────────────────────
// Hooks are JS files in .flowboard/hooks/ that export functions.
// Each hook file exports: { beforeRun, afterToolExecution, onError, afterRun }

function loadHooks(projectRoot) {
  const hooksDir = path.join(projectRoot, FLOWBOARD_DIR, 'hooks');
  const hooks = { beforeRun: [], afterToolExecution: [], onError: [], afterRun: [] };
  if (!fs.existsSync(hooksDir)) return hooks;
  try {
    for (const file of fs.readdirSync(hooksDir)) {
      if (!file.endsWith('.js')) continue;
      try {
        const hookModule = require(path.join(hooksDir, file));
        for (const key of Object.keys(hooks)) {
          if (typeof hookModule[key] === 'function') hooks[key].push(hookModule[key]);
        }
      } catch {}
    }
  } catch {}
  return hooks;
}

async function runHook(hooks, hookName, context) {
  const fns = hooks[hookName] || [];
  for (const fn of fns) {
    try { await fn(context); } catch {}
  }
}

// ─── Briefings ───────────────────────────────────────────
// Markdown files in .flowboard/briefings/ that provide pre-loaded context.
// Format: briefing-name.md with optional frontmatter.

function getBriefingsDir(projectRoot) {
  return path.join(projectRoot, FLOWBOARD_DIR, 'briefings');
}

function listBriefings(projectRoot) {
  const dir = getBriefingsDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8');
        const name = f.replace('.md', '');
        // Extract description from first line after frontmatter
        let description = '';
        const lines = content.split('\n');
        for (const line of lines) {
          if (line.startsWith('#')) { description = line.replace(/^#+\s*/, ''); break; }
          if (line.trim() && !line.startsWith('---')) { description = line.trim(); break; }
        }
        return { name, description, file: f };
      });
  } catch { return []; }
}

function loadBriefing(projectRoot, name) {
  const file = path.join(getBriefingsDir(projectRoot), `${name}.md`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf-8');
}

function saveBriefing(projectRoot, name, content) {
  const dir = getBriefingsDir(projectRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  fs.writeFileSync(path.join(dir, `${safeName}.md`), content, 'utf-8');
  return safeName;
}

function deleteBriefing(projectRoot, name) {
  const file = path.join(getBriefingsDir(projectRoot), `${name}.md`);
  if (fs.existsSync(file)) { fs.unlinkSync(file); return true; }
  return false;
}

module.exports = { loadHooks, runHook, listBriefings, loadBriefing, saveBriefing, deleteBriefing };
