/**
 * Flowboard AI — Agent Memory System
 * 
 * 3 layers:
 * 1. Project Memory — persistent facts, decisions, conventions (.flowboard/memory.md)
 * 2. Card Memory — per-task conversation history (.flowboard/agent-history/)
 * 3. Knowledge Base — important files agent should always know (.flowboard/knowledge/)
 */
const fs = require('fs');
const path = require('path');

const FLOWBOARD_DIR = '.flowboard';
const MEMORY_FILE = 'memory.md';
const KNOWLEDGE_DIR = 'knowledge';

// ─── Project Memory ──────────────────────────────────────
// A markdown file that accumulates project facts, decisions, and conventions.
// Agent can read and append to it.

function getMemoryPath(projectRoot) {
  return path.join(projectRoot, FLOWBOARD_DIR, MEMORY_FILE);
}

function loadProjectMemory(projectRoot) {
  const file = getMemoryPath(projectRoot);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf-8');
}

function appendProjectMemory(projectRoot, entry) {
  const dir = path.join(projectRoot, FLOWBOARD_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = getMemoryPath(projectRoot);
  const timestamp = new Date().toISOString().slice(0, 16);
  const formatted = `\n## [${timestamp}]\n${entry}\n`;
  fs.appendFileSync(file, formatted, 'utf-8');
  return formatted;
}

function resetProjectMemory(projectRoot) {
  const file = getMemoryPath(projectRoot);
  const header = `# Project Memory\n\nThis file stores persistent knowledge about the project that the AI agent should remember across sessions.\n\n---\n`;
  const dir = path.join(projectRoot, FLOWBOARD_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, header, 'utf-8');
}

// ─── Knowledge Base ──────────────────────────────────────
// Directory of files that agent should always have in context.
// User can add important files (API specs, style guides, etc.)

function getKnowledgePath(projectRoot) {
  return path.join(projectRoot, FLOWBOARD_DIR, KNOWLEDGE_DIR);
}

function loadKnowledge(projectRoot) {
  const dir = getKnowledgePath(projectRoot);
  if (!fs.existsSync(dir)) return [];
  const files = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isFile()) {
        files.push({ name, content: fs.readFileSync(full, 'utf-8').slice(0, 3000) });
      }
    }
  } catch {}
  return files;
}

function addKnowledge(projectRoot, name, content) {
  const dir = getKnowledgePath(projectRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  fs.writeFileSync(path.join(dir, safeName), content, 'utf-8');
  return safeName;
}

function removeKnowledge(projectRoot, name) {
  const file = path.join(getKnowledgePath(projectRoot), name);
  if (fs.existsSync(file)) { fs.unlinkSync(file); return true; }
  return false;
}

function listKnowledge(projectRoot) {
  const dir = getKnowledgePath(projectRoot);
  if (!fs.existsSync(dir)) return [];
  try { return fs.readdirSync(dir).filter(f => !f.startsWith('.')); }
  catch { return []; }
}

// ─── Self-Improvement: Lessons ───────────────────────────
// Stores error patterns and successful strategies for adaptive behavior.

const LESSONS_FILE = 'lessons.md';

function getLessonsPath(projectRoot) {
  return path.join(projectRoot, FLOWBOARD_DIR, LESSONS_FILE);
}

function loadLessons(projectRoot) {
  const file = getLessonsPath(projectRoot);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf-8');
}

function addLesson(projectRoot, type, lesson) {
  const dir = path.join(projectRoot, FLOWBOARD_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = getLessonsPath(projectRoot);
  const timestamp = new Date().toISOString().slice(0, 16);
  const tag = type === 'error' ? 'ERROR' : type === 'success' ? 'SUCCESS' : 'LESSON';
  const entry = `\n- [${tag} ${timestamp}] ${lesson}\n`;
  fs.appendFileSync(file, entry, 'utf-8');
}

function buildMemoryContext(projectRoot) {
  let context = '';
  const MAX_MEMORY_TOKENS = 4000; // cap to prevent overflow
  let budget = MAX_MEMORY_TOKENS;

  const memory = loadProjectMemory(projectRoot);
  if (memory && budget > 0) {
    const slice = memory.slice(-2000);
    budget -= Math.ceil(slice.length / 4);
    context += `\n--- PROJECT MEMORY ---\n${slice}\n`;
  }

  const lessons = loadLessons(projectRoot);
  if (lessons && budget > 0) {
    const slice = lessons.slice(-1000);
    budget -= Math.ceil(slice.length / 4);
    context += `\n--- LESSONS LEARNED ---\n${slice}\n`;
  }

  const knowledge = loadKnowledge(projectRoot);
  if (knowledge.length > 0 && budget > 0) {
    context += `\n--- KNOWLEDGE BASE ---\n`;
    for (const k of knowledge) {
      const entry = `\n### ${k.name}\n${k.content}\n`;
      const tokens = Math.ceil(entry.length / 4);
      if (tokens > budget) break;
      budget -= tokens;
      context += entry;
    }
  }

  return context;
}

module.exports = {
  loadProjectMemory, appendProjectMemory, resetProjectMemory,
  loadKnowledge, addKnowledge, removeKnowledge, listKnowledge,
  buildMemoryContext, loadLessons, addLesson
};
