/**
 * Flowboard AI — Tool Executor (v3)
 * Complete toolset for agentic coding
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const TOOL_DEFINITIONS = [
  // ─── Shell ─────────────────────────────────────────────
  { type: 'function', function: { name: 'bash', description: 'Execute a shell command. Use for running scripts, git, npm, tests, etc.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to execute' }, timeout: { type: 'number', description: 'Timeout in ms (default 30000)' } }, required: ['command'] } } },

  // ─── File Read ─────────────────────────────────────────
  { type: 'function', function: { name: 'read_file', description: 'Read file contents with line numbers. Use offset/limit for large files.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, offset: { type: 'number', description: 'Start line (0-indexed)' }, limit: { type: 'number', description: 'Max lines to read' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'file_info', description: 'Get file metadata: size, modified date, type, line count.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] } } },

  // ─── File Write ────────────────────────────────────────
  { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file with full content.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, content: { type: 'string', description: 'Full file content' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: 'Replace first occurrence of a string in a file.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, old_string: { type: 'string', description: 'Exact string to find (include enough context for uniqueness)' }, new_string: { type: 'string', description: 'Replacement string' } }, required: ['path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'multi_edit', description: 'Apply multiple find-and-replace edits to a single file atomically.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, edits: { type: 'array', description: 'Array of {old_string, new_string} pairs', items: { type: 'object', properties: { old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['old_string', 'new_string'] } } }, required: ['path', 'edits'] } } },
  { type: 'function', function: { name: 'insert_lines', description: 'Insert text at a specific line number without replacing existing content.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, line: { type: 'number', description: 'Line number to insert at (1-indexed, content shifts down)' }, content: { type: 'string', description: 'Text to insert' } }, required: ['path', 'line', 'content'] } } },
  { type: 'function', function: { name: 'patch', description: 'Apply a unified diff patch to a file.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, diff: { type: 'string', description: 'Unified diff content (lines starting with +/- and context)' } }, required: ['path', 'diff'] } } },

  // ─── File Management ───────────────────────────────────
  { type: 'function', function: { name: 'delete_file', description: 'Delete a file or empty directory.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File or directory path' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'rename_file', description: 'Rename or move a file.', parameters: { type: 'object', properties: { old_path: { type: 'string', description: 'Current file path' }, new_path: { type: 'string', description: 'New file path' } }, required: ['old_path', 'new_path'] } } },
  { type: 'function', function: { name: 'copy_file', description: 'Copy a file to a new location.', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source file path' }, destination: { type: 'string', description: 'Destination file path' } }, required: ['source', 'destination'] } } },

  // ─── Search & Navigation ───────────────────────────────
  { type: 'function', function: { name: 'grep', description: 'Search for a regex pattern across files. Returns matching lines with file paths and line numbers.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Search pattern (regex)' }, path: { type: 'string', description: 'Directory to search (default: .)' }, include: { type: 'string', description: 'File glob filter e.g. "*.js"' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'glob', description: 'Find files matching a glob pattern. Ignores node_modules and hidden files.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob pattern e.g. "src/**/*.ts"' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'ls', description: 'List directory contents (non-recursive, non-hidden).', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path (default: .)' } } } } },
  { type: 'function', function: { name: 'tree', description: 'Show recursive directory tree structure. Use for understanding project layout.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Root directory (default: .)' }, depth: { type: 'number', description: 'Max depth (default: 3)' }, include: { type: 'string', description: 'File extension filter e.g. ".js,.ts"' } }, } } },
  { type: 'function', function: { name: 'find_definition', description: 'Find where a function, class, or variable is defined in the codebase.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Symbol name to find (function, class, variable)' }, path: { type: 'string', description: 'Directory to search (default: .)' } }, required: ['name'] } } },

  // ─── Network ───────────────────────────────────────────
  { type: 'function', function: { name: 'fetch_url', description: 'Fetch content from a URL. Use for reading documentation, APIs, or web pages.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to fetch' }, method: { type: 'string', description: 'HTTP method (default: GET)' }, headers: { type: 'object', description: 'Request headers' }, body: { type: 'string', description: 'Request body (for POST/PUT)' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Search the web for documentation, solutions, or information. Returns snippets and URLs.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, num_results: { type: 'number', description: 'Number of results (default: 5, max: 10)' } }, required: ['query'] } } },

  // ─── CI/CD ─────────────────────────────────────────────
  { type: 'function', function: { name: 'run_tests', description: 'Run the project test suite and return results. Auto-detects test runner.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Custom test command (auto-detects if omitted)' }, timeout: { type: 'number', description: 'Timeout in ms (default: 60000)' } } } } },
  { type: 'function', function: { name: 'check_ci', description: 'Check CI/CD status — reads GitHub Actions, GitLab CI, or local test results.', parameters: { type: 'object', properties: { service: { type: 'string', description: 'CI service: github, gitlab, or local (default: auto-detect)' } } } } },

  // ─── Memory ─────────────────────────────────────────────
  { type: 'function', function: { name: 'memory_read', description: 'Read the project memory — persistent facts, decisions, and conventions remembered across sessions.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'memory_write', description: 'Save an important fact, decision, or convention to project memory. Use this to remember things for future sessions.', parameters: { type: 'object', properties: { content: { type: 'string', description: 'What to remember (architecture decisions, user preferences, conventions, etc.)' } }, required: ['content'] } } },

  // ─── Agent Control ─────────────────────────────────────
  { type: 'function', function: { name: 'ask_user', description: 'Ask the user a question and wait for their response. Use when you need clarification or a decision.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'Question to ask the user' }, options: { type: 'array', description: 'Optional multiple choice options', items: { type: 'string' } }, default_answer: { type: 'string', description: 'Default answer if user does not respond' } }, required: ['question'] } } },
  { type: 'function', function: { name: 'spawn_subagent', description: 'Spawn a subagent to handle a subtask independently. Returns when subtask is complete.', parameters: { type: 'object', properties: { task: { type: 'string', description: 'Task description for the subagent' }, context: { type: 'string', description: 'Additional context (files to focus on, constraints)' }, preset: { type: 'string', description: 'Preset to use (default, bugfix, feature, refactor, test)' } }, required: ['task'] } } },
  { type: 'function', function: { name: 'save_skill', description: 'Save a successful approach as a reusable skill for future tasks. Use after completing a complex task well.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Skill name (kebab-case, e.g. "react-form-builder")' }, description: { type: 'string', description: 'Short description of what this skill does' }, content: { type: 'string', description: 'The full skill instructions/approach in markdown' } }, required: ['name', 'description', 'content'] } } },
  { type: 'function', function: { name: 'task_complete', description: 'Signal that the task is complete. Provide a summary of what was done.', parameters: { type: 'object', properties: { summary: { type: 'string', description: 'Brief summary of what was accomplished' }, files_changed: { type: 'array', description: 'List of files that were modified', items: { type: 'string' } } }, required: ['summary'] } } }
];

const PERMISSIONS = {
  bash: 'dangerous',
  write_file: 'dangerous', edit_file: 'dangerous', multi_edit: 'dangerous',
  insert_lines: 'dangerous', patch: 'dangerous',
  delete_file: 'dangerous', rename_file: 'dangerous', copy_file: 'dangerous',
  read_file: 'safe', file_info: 'safe',
  grep: 'safe', glob: 'safe', ls: 'safe', tree: 'safe', find_definition: 'safe',
  fetch_url: 'safe', web_search: 'safe',
  run_tests: 'dangerous', check_ci: 'safe',
  memory_read: 'safe', memory_write: 'safe',
  ask_user: 'safe', spawn_subagent: 'safe', save_skill: 'safe',
  task_complete: 'safe'
};

// Track file changes
const fileChanges = [];
function getFileChanges() { return fileChanges; }
function clearFileChanges() { fileChanges.length = 0; }

function resolvePath(projectRoot, filePath) {
  const resolved = path.resolve(projectRoot, filePath);
  if (!resolved.startsWith(path.resolve(projectRoot))) throw new Error(`Path traversal blocked: ${filePath}`);
  return resolved;
}

function createDiff(oldContent, newContent, filePath) {
  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');
  const diff = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) {
      if (i < oldLines.length && oldLines[i] !== undefined) diff.push(`- ${oldLines[i]}`);
      if (i < newLines.length && newLines[i] !== undefined) diff.push(`+ ${newLines[i]}`);
    }
  }
  return { file: filePath, hunks: diff.slice(0, 50), totalChanges: diff.length };
}

function executeTool(name, args, projectRoot) {
  const cwd = projectRoot || process.cwd();
  if (!args) args = {};

  try {
    switch (name) {

    case 'bash': {
      if (!args.command) return { success: false, output: 'Missing required: command' };
      try {
        const result = execSync(args.command, {
          cwd, timeout: args.timeout || 30000, encoding: 'utf-8',
          maxBuffer: 1024 * 1024, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
        });
        return { success: true, output: result.slice(0, 10000) };
      } catch (err) {
        return { success: false, output: ((err.stdout || '') + '\n' + (err.stderr || err.message)).slice(0, 5000), exitCode: err.status };
      }
    }

    case 'read_file': {
      if (!args.path) return { success: false, output: 'Missing required: path' };
      const fp = resolvePath(cwd, args.path);
      if (!fs.existsSync(fp)) return { success: false, output: `File not found: ${args.path}` };
      const content = fs.readFileSync(fp, 'utf-8');
      const lines = content.split('\n');
      const offset = args.offset || 0;
      const limit = args.limit || lines.length;
      return { success: true, output: lines.slice(offset, offset + limit).map((l, i) => `${offset + i + 1}| ${l}`).join('\n') };
    }

    case 'file_info': {
      if (!args.path) return { success: false, output: 'Missing required: path' };
      const fp = resolvePath(cwd, args.path);
      if (!fs.existsSync(fp)) return { success: false, output: `Not found: ${args.path}` };
      const stat = fs.statSync(fp);
      const info = { path: args.path, size: stat.size, modified: stat.mtime.toISOString(), isDirectory: stat.isDirectory() };
      if (!stat.isDirectory()) {
        const content = fs.readFileSync(fp, 'utf-8');
        info.lines = content.split('\n').length;
        info.extension = path.extname(fp);
      }
      return { success: true, output: JSON.stringify(info, null, 2) };
    }

    case 'write_file': {
      if (!args.path || args.content === undefined) return { success: false, output: 'Missing required: path, content' };
      const fp = resolvePath(cwd, args.path);
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const oldContent = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : null;
      fs.writeFileSync(fp, args.content, 'utf-8');
      const diff = createDiff(oldContent, args.content, args.path);
      fileChanges.push({ type: 'write', path: args.path, diff, ts: Date.now() });
      return { success: true, output: `Written ${args.content.length} bytes to ${args.path}`, diff };
    }

    case 'edit_file': {
      if (!args.path || !args.old_string) return { success: false, output: 'Missing required: path, old_string' };
      const fp = resolvePath(cwd, args.path);
      if (!fs.existsSync(fp)) return { success: false, output: `File not found: ${args.path}` };
      const oldContent = fs.readFileSync(fp, 'utf-8');
      if (!oldContent.includes(args.old_string)) return { success: false, output: `String not found in file.` };
      const newContent = oldContent.replace(args.old_string, args.new_string);
      fs.writeFileSync(fp, newContent, 'utf-8');
      const diff = createDiff(oldContent, newContent, args.path);
      fileChanges.push({ type: 'edit', path: args.path, diff, ts: Date.now() });
      return { success: true, output: `Edited ${args.path}`, diff };
    }

    case 'multi_edit': {
      if (!args.path || !args.edits || !args.edits.length) return { success: false, output: 'Missing required: path, edits' };
      const fp = resolvePath(cwd, args.path);
      if (!fs.existsSync(fp)) return { success: false, output: `File not found: ${args.path}` };
      const oldContent = fs.readFileSync(fp, 'utf-8');
      let content = oldContent;
      let applied = 0;
      for (const edit of args.edits) {
        if (content.includes(edit.old_string)) {
          content = content.replace(edit.old_string, edit.new_string);
          applied++;
        }
      }
      if (applied === 0) return { success: false, output: 'No edits matched.' };
      fs.writeFileSync(fp, content, 'utf-8');
      const diff = createDiff(oldContent, content, args.path);
      fileChanges.push({ type: 'multi_edit', path: args.path, diff, ts: Date.now() });
      return { success: true, output: `Applied ${applied}/${args.edits.length} edits to ${args.path}`, diff };
    }

    case 'insert_lines': {
      if (!args.path || !args.line || args.content === undefined) return { success: false, output: 'Missing required: path, line, content' };
      const fp = resolvePath(cwd, args.path);
      if (!fs.existsSync(fp)) return { success: false, output: `File not found: ${args.path}` };
      const oldContent = fs.readFileSync(fp, 'utf-8');
      const lines = oldContent.split('\n');
      const insertAt = Math.max(0, Math.min(args.line - 1, lines.length));
      const newLines = args.content.split('\n');
      lines.splice(insertAt, 0, ...newLines);
      const newContent = lines.join('\n');
      fs.writeFileSync(fp, newContent, 'utf-8');
      const diff = createDiff(oldContent, newContent, args.path);
      fileChanges.push({ type: 'insert', path: args.path, diff, ts: Date.now() });
      return { success: true, output: `Inserted ${newLines.length} lines at line ${args.line} in ${args.path}`, diff };
    }

    case 'patch': {
      if (!args.path || !args.diff) return { success: false, output: 'Missing required: path, diff' };
      const fp = resolvePath(cwd, args.path);
      if (!fs.existsSync(fp)) return { success: false, output: `File not found: ${args.path}` };
      const oldContent = fs.readFileSync(fp, 'utf-8');
      const lines = oldContent.split('\n');
      const patchLines = args.diff.split('\n');
      let lineIdx = 0;
      const result = [];
      for (const pl of patchLines) {
        if (pl.startsWith('@@')) {
          const match = pl.match(/@@ -(\d+)/);
          if (match) { const target = parseInt(match[1]) - 1; while (lineIdx < target) { result.push(lines[lineIdx++]); } }
        } else if (pl.startsWith('-')) { lineIdx++; }
        else if (pl.startsWith('+')) { result.push(pl.slice(1)); }
        else if (pl.startsWith(' ')) { result.push(lines[lineIdx++]); }
      }
      while (lineIdx < lines.length) result.push(lines[lineIdx++]);
      const newContent = result.join('\n');
      fs.writeFileSync(fp, newContent, 'utf-8');
      const diff = createDiff(oldContent, newContent, args.path);
      fileChanges.push({ type: 'patch', path: args.path, diff, ts: Date.now() });
      return { success: true, output: `Patched ${args.path}`, diff };
    }

    case 'delete_file': {
      if (!args.path) return { success: false, output: 'Missing required: path' };
      const fp = resolvePath(cwd, args.path);
      if (!fs.existsSync(fp)) return { success: false, output: `Not found: ${args.path}` };
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) fs.rmdirSync(fp);
      else fs.unlinkSync(fp);
      fileChanges.push({ type: 'delete', path: args.path, ts: Date.now() });
      return { success: true, output: `Deleted ${args.path}` };
    }

    case 'rename_file': {
      if (!args.old_path || !args.new_path) return { success: false, output: 'Missing required: old_path, new_path' };
      const src = resolvePath(cwd, args.old_path);
      const dst = resolvePath(cwd, args.new_path);
      if (!fs.existsSync(src)) return { success: false, output: `Not found: ${args.old_path}` };
      const dstDir = path.dirname(dst);
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
      fs.renameSync(src, dst);
      fileChanges.push({ type: 'rename', path: `${args.old_path} -> ${args.new_path}`, ts: Date.now() });
      return { success: true, output: `Renamed ${args.old_path} -> ${args.new_path}` };
    }

    case 'copy_file': {
      if (!args.source || !args.destination) return { success: false, output: 'Missing required: source, destination' };
      const src = resolvePath(cwd, args.source);
      const dst = resolvePath(cwd, args.destination);
      if (!fs.existsSync(src)) return { success: false, output: `Not found: ${args.source}` };
      const dstDir = path.dirname(dst);
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(src, dst);
      return { success: true, output: `Copied ${args.source} -> ${args.destination}` };
    }

    case 'grep': {
      if (!args.pattern) return { success: false, output: 'Missing required: pattern' };
      const searchPath = resolvePath(cwd, args.path || '.');
      try {
        let cmd = process.platform === 'win32'
          ? `findstr /S /N /R "${args.pattern}" ${args.include || '*.*'}`
          : `grep -rn ${args.include ? `--include="${args.include}"` : ''} "${args.pattern}" "${searchPath}"`;
        const result = execSync(cmd, { cwd: searchPath, encoding: 'utf-8', maxBuffer: 512 * 1024, timeout: 10000 });
        return { success: true, output: result.slice(0, 8000) };
      } catch (err) {
        return { success: err.status === 1, output: err.status === 1 ? 'No matches found.' : err.message };
      }
    }

    case 'glob': {
      if (!args.pattern) return { success: false, output: 'Missing required: pattern' };
      const results = [];
      function walkGlob(dir) {
        try {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === '__pycache__') continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walkGlob(full);
            else if (matchGlob(path.relative(cwd, full).replace(/\\/g, '/'), args.pattern)) results.push(path.relative(cwd, full).replace(/\\/g, '/'));
          }
        } catch {}
      }
      walkGlob(cwd);
      return { success: true, output: results.slice(0, 200).join('\n') || 'No files found.' };
    }

    case 'ls': {
      const dir = resolvePath(cwd, args.path || '.');
      if (!fs.existsSync(dir)) return { success: false, output: `Not found: ${args.path}` };
      const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => !e.name.startsWith('.'));
      return { success: true, output: entries.map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`).slice(0, 100).join('\n') };
    }

    case 'tree': {
      const root = resolvePath(cwd, args.path || '.');
      const maxDepth = args.depth || 3;
      const extFilter = args.include ? args.include.split(',').map(e => e.trim()) : null;
      const lines = [];
      function walkTree(dir, prefix, depth) {
        if (depth > maxDepth) return;
        let entries;
        try { entries = fs.readdirSync(dir).filter(n => !n.startsWith('.') && n !== 'node_modules' && n !== 'dist' && n !== '__pycache__'); }
        catch { return; }
        entries.sort();
        entries.forEach((name, i) => {
          const full = path.join(dir, name);
          const isLast = i === entries.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const isDir = fs.statSync(full).isDirectory();
          if (!isDir && extFilter && !extFilter.some(ext => name.endsWith(ext))) return;
          lines.push(prefix + connector + name + (isDir ? '/' : ''));
          if (isDir) walkTree(full, prefix + (isLast ? '    ' : '│   '), depth + 1);
        });
      }
      lines.push(path.basename(root) + '/');
      walkTree(root, '', 0);
      return { success: true, output: lines.slice(0, 300).join('\n') };
    }

    case 'find_definition': {
      if (!args.name) return { success: false, output: 'Missing required: name' };
      const searchDir = resolvePath(cwd, args.path || '.');
      const patterns = [
        `function ${args.name}`, `const ${args.name}`, `let ${args.name}`, `var ${args.name}`,
        `class ${args.name}`, `def ${args.name}`, `export function ${args.name}`,
        `export const ${args.name}`, `export class ${args.name}`, `${args.name} =`, `${args.name}(`
      ];
      const results = [];
      function searchFiles(dir) {
        try {
          for (const entry of fs.readdirSync(dir)) {
            if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) { searchFiles(full); continue; }
            if (!/\.(js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|h|cs)$/.test(entry)) continue;
            const content = fs.readFileSync(full, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (patterns.some(p => lines[i].includes(p))) {
                results.push(`${path.relative(cwd, full).replace(/\\/g, '/')}:${i + 1}: ${lines[i].trim()}`);
              }
            }
          }
        } catch {}
      }
      searchFiles(searchDir);
      return { success: true, output: results.slice(0, 30).join('\n') || `No definition found for "${args.name}"` };
    }

    case 'fetch_url': {
      if (!args.url) return { success: false, output: 'Missing required: url' };
      try {
        const safeUrl = args.url.replace(/'/g, '');
        const cmd = `node -e "const h=require('${safeUrl.startsWith('https') ? 'https' : 'http'}');h.get('${safeUrl}',{headers:{'User-Agent':'Mozilla/5.0'}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>process.stdout.write(d))}).on('error',e=>process.stderr.write(e.message))"`;
        const result = execSync(cmd, { encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024 });
        let output = result;
        if (output.includes('<html') || output.includes('<!DOCTYPE')) {
          output = output.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        return { success: true, output: output.slice(0, 10000) };
      } catch (err) {
        return { success: false, output: `Fetch failed: ${err.message}` };
      }
    }

    case 'run_tests': {
      let testCmd = args.command;
      if (!testCmd) {
        // Auto-detect test runner
        if (fs.existsSync(path.join(cwd, 'package.json'))) {
          const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
          testCmd = pkg.scripts?.test || 'npm test';
        } else if (fs.existsSync(path.join(cwd, 'Makefile'))) testCmd = 'make test';
        else if (fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'setup.py'))) testCmd = 'pytest';
        else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) testCmd = 'cargo test';
        else testCmd = 'npm test';
      }
      try {
        const result = execSync(testCmd, { cwd, timeout: args.timeout || 60000, encoding: 'utf-8', maxBuffer: 1024 * 1024, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash' });
        return { success: true, output: `Tests passed.\n${result.slice(-3000)}` };
      } catch (err) {
        return { success: false, output: `Tests failed.\n${((err.stdout || '') + '\n' + (err.stderr || '')).slice(-3000)}`, exitCode: err.status };
      }
    }

    case 'check_ci': {
      // Check for CI config and recent results
      const results = [];
      if (fs.existsSync(path.join(cwd, '.github/workflows'))) {
        const workflows = fs.readdirSync(path.join(cwd, '.github/workflows'));
        results.push(`GitHub Actions: ${workflows.length} workflow(s) — ${workflows.join(', ')}`);
        // Try gh CLI
        try {
          const status = execSync('gh run list --limit 3', { cwd, encoding: 'utf-8', timeout: 10000 });
          results.push(status.trim());
        } catch { results.push('(gh CLI not available — install GitHub CLI for live status)'); }
      }
      if (fs.existsSync(path.join(cwd, '.gitlab-ci.yml'))) {
        results.push('GitLab CI: .gitlab-ci.yml found');
        try {
          const status = execSync('glab ci status', { cwd, encoding: 'utf-8', timeout: 10000 });
          results.push(status.trim());
        } catch { results.push('(glab CLI not available)'); }
      }
      if (results.length === 0) results.push('No CI/CD configuration detected (.github/workflows or .gitlab-ci.yml)');
      return { success: true, output: results.join('\n') };
    }

    case 'memory_read': {
      const { loadProjectMemory } = require('./memory');
      const memory = loadProjectMemory(cwd);
      return { success: true, output: memory || 'No project memory yet.' };
    }

    case 'memory_write': {
      if (!args.content) return { success: false, output: 'Missing required: content' };
      const { appendProjectMemory } = require('./memory');
      appendProjectMemory(cwd, args.content);
      return { success: true, output: `Saved to project memory.` };
    }

    case 'web_search': {
      if (!args.query) return { success: false, output: 'Missing required: query' };
      try {
        const num = Math.min(args.num_results || 5, 10);
        const q = encodeURIComponent(args.query);
        // Strategy: try bash-based search (works cross-platform)
        // Uses DuckDuckGo lite (no JS required) or falls back gracefully
        let cmd;
        if (process.platform === 'win32') {
          cmd = `node -e "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';const https=require('https');const http=require('http');function fetch(u,cb){const m=u.startsWith('https')?https:http;m.get(u,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}},r=>{if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){fetch(r.headers.location,cb)}else{let d='';r.on('data',c=>d+=c;r.on('end',()=>cb(d))}}).on('error',()=>cb(''))}fetch('https://lite.duckduckgo.com/lite/?q=${q}',d=>process.stdout.write(d))"`;
        } else {
          cmd = `curl -sL "https://lite.duckduckgo.com/lite/?q=${q}"`;
        }
        let html = '';
        try { html = execSync(cmd, { encoding: 'utf-8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 }); } catch {}

        const results = [];
        if (html) {
          // Parse DDG lite results
          const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi;
          const snippetRegex = /<td class="result-snippet">([\s\S]*?)<\/td>/gi;
          let linkMatch, snippetMatch;
          const links = [];
          while ((linkMatch = linkRegex.exec(html)) && links.length < num) {
            links.push({ url: linkMatch[1], title: linkMatch[2].replace(/<[^>]+>/g, '').trim() });
          }
          const snippets = [];
          while ((snippetMatch = snippetRegex.exec(html))) {
            snippets.push(snippetMatch[1].replace(/<[^>]+>/g, '').trim());
          }
          for (let i = 0; i < links.length; i++) {
            results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] || '' });
          }
        }

        if (results.length === 0) {
          // Provide helpful fallback
          return { success: true, output: `Web search unavailable (network/ISP restriction). Use fetch_url to read specific documentation URLs directly, or use bash with "npm info <package>" for package info.` };
        }
        return { success: true, output: results.slice(0, num).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n') };
      } catch (err) {
        return { success: false, output: `Search failed: ${err.message}. Use fetch_url with a known URL instead.` };
      }
    }

    case 'ask_user': {
      if (!args.question) return { success: false, output: 'Missing required: question' };
      // This is handled specially by the agent loop — returns a marker
      return { success: true, output: '__ASK_USER__', question: args.question, options: args.options || null, default_answer: args.default_answer || null };
    }

    case 'spawn_subagent': {
      if (!args.task) return { success: false, output: 'Missing required: task' };
      // This is handled specially by the agent loop — returns a marker
      return { success: true, output: '__SPAWN_SUBAGENT__', task: args.task, context: args.context || '', preset: args.preset || 'default' };
    }

    case 'save_skill': {
      if (!args.name || !args.content) return { success: false, output: 'Missing required: name, content' };
      const home = process.env.USERPROFILE || process.env.HOME || '';
      const skillDir = path.join(home, '.flowboard', 'skills', args.name.replace(/[^a-zA-Z0-9-_]/g, '-'));
      if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
      const skillContent = `---\nname: ${args.name}\ndescription: ${args.description || ''}\n---\n\n${args.content}`;
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      return { success: true, output: `Skill saved: ${args.name} (${skillDir})` };
    }

    case 'task_complete': {
      if (!args.summary) return { success: false, output: 'Missing required: summary' };
      return { success: true, output: `Task complete: ${args.summary}`, filesChanged: args.files_changed || [] };
    }

    default: return { success: false, output: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { success: false, output: `Error: ${err.message}` };
  }
}

function matchGlob(filePath, pattern) {
  const regex = pattern.replace(/\./g, '\\.').replace(/\*\*/g, '{{G}}').replace(/\*/g, '[^/]*').replace(/{{G}}/g, '.*');
  return new RegExp(`^${regex}$`).test(filePath);
}

module.exports = { TOOL_DEFINITIONS, PERMISSIONS, executeTool, getFileChanges, clearFileChanges };
