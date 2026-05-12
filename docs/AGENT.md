# Agent System Documentation

## Overview

Flowboard AI's agent system is a complete agentic coding environment with 25 tools, 3-layer memory, streaming output, auto-retry, undo, subagents, and lifecycle hooks.

---

## Tools (26)

### Shell
| Tool | Permission | Description |
|------|-----------|-------------|
| `bash` | dangerous | Execute shell commands (async, cancellable via SIGTERM) |

### File Read
| Tool | Permission | Description |
|------|-----------|-------------|
| `read_file` | safe | Read file with line numbers, supports offset/limit |
| `file_info` | safe | Get metadata: size, modified date, line count |

### File Write
| Tool | Permission | Description |
|------|-----------|-------------|
| `write_file` | dangerous | Create or overwrite file (auto-backup for undo) |
| `edit_file` | dangerous | Find & replace single occurrence |
| `multi_edit` | dangerous | Multiple find & replace atomically |
| `insert_lines` | dangerous | Insert text at specific line |
| `patch` | dangerous | Apply unified diff |

### File Management
| Tool | Permission | Description |
|------|-----------|-------------|
| `delete_file` | dangerous | Delete file or empty directory |
| `rename_file` | dangerous | Rename or move file |
| `copy_file` | dangerous | Copy file to new location |

### Search & Navigation
| Tool | Permission | Description |
|------|-----------|-------------|
| `grep` | safe | Regex search across files |
| `glob` | safe | Find files by glob pattern |
| `ls` | safe | List directory contents |
| `tree` | safe | Recursive directory tree with depth control |
| `find_definition` | safe | Find function/class/variable definitions |

### Network
| Tool | Permission | Description |
|------|-----------|-------------|
| `fetch_url` | safe | HTTP fetch, auto-strips HTML |
| `web_search` | safe | DuckDuckGo search with fallback |

### CI/CD
| Tool | Permission | Description |
|------|-----------|-------------|
| `run_tests` | dangerous | Auto-detect and run test suite |
| `check_ci` | safe | Check GitHub Actions / GitLab CI status |

### Memory
| Tool | Permission | Description |
|------|-----------|-------------|
| `memory_read` | safe | Read project memory |
| `memory_write` | safe | Save fact/decision to memory |

### Agent Control
| Tool | Permission | Description |
|------|-----------|-------------|
| `ask_user` | safe | Ask user question mid-execution (text or multiple choice) |
| `spawn_subagent` | safe | Delegate subtask to child agent |
| `save_skill` | safe | Save successful approach as reusable skill |
| `task_complete` | safe | Signal task done with summary |

---

## Agent Loop Features

### Streaming (Token-by-token)
LLM responses stream via SSE. Each token emits a `stream_token` event to the frontend, displayed in real-time with a typing effect.

### Auto-Retry (Exponential Backoff)
On HTTP 429/500/502/503 errors, the agent retries up to 3 times with delays of 1s, 3s, 8s. A `retry_attempt` event notifies the frontend.

### Cancel Mid-Tool
Bash commands run via `spawn()` (not `execSync`). On abort, the process receives SIGTERM immediately — no waiting for timeout.

### Undo
Before every file write/edit/patch/delete, the original content is backed up in memory. The `/api/agent/undo` endpoint reverts all changes from a session.

### Token Budget
Pass `tokenBudget` (in USD) to `/api/agent/run`. The agent checks cost after each iteration and auto-stops when the budget is reached.

### Progress Indicator
Each iteration emits a `progress` event with `{step, maxSteps}`. Frontend shows "Step 3/25".

### Context Compaction
Auto-triggers at 80% context window usage. Keeps system prompt + last 6 messages, summarizes the rest. Manual compact via `/api/agent/compact` or toolbar button.

### Conversation Branching
`/api/agent/fork` creates a new session from any message index. User can try different approaches without losing history.

### File Watcher
`/api/agent/watch` starts `fs.watch(recursive)` on the project. External file changes are detected and can be reported to the agent.

### Export as Markdown
`/api/agent/export` generates a full markdown report of the conversation including tool calls, outputs, and file changes.

---

## Memory System

### Project Memory (`.flowboard/memory.md`)
Persistent markdown file accumulating facts, decisions, and conventions. Agent reads on start, writes via `memory_write`. Last 2000 chars injected into context.

### Lessons Learned (`.flowboard/lessons.md`)
Auto-populated by the self-improvement system. Records errors and successes with timestamps. Last 1000 chars injected into every session context so the agent avoids repeating mistakes.

### Knowledge Base (`.flowboard/knowledge/`)
Directory of reference files always included in agent context. Each file max 3000 chars. User manages via API or filesystem.

### Card Memory (`.flowboard/agent-history/<cardId>.json`)
Per-task conversation history. Auto-saved after each run. Enables multi-turn sessions.

---

## Context Injection

Every session receives (budget-capped to prevent overflow):
```
System Prompt (preset + skill)
+ PROJECT CONTEXT (max 12,000 tokens):
  ├── Project tree (2 levels, max 60 entries)
  ├── Package info (name, deps)
  ├── README (first 500 chars)
  ├── Git (branch + modified files)
  └── Env vars (keys only)
+ MEMORY CONTEXT (max 4,000 tokens):
  ├── Project memory (last 2000 chars)
  ├── Lessons learned (last 1000 chars)
  └── Knowledge base (files until budget exhausted)
```

Total injection capped at ~16,000 tokens. Remaining context (112K+) available for conversation. Auto-compact triggers at 80% context usage.

---

## Lifecycle Hooks

Place JS files in `.flowboard/hooks/`:

```javascript
// .flowboard/hooks/my-hook.js
module.exports = {
  beforeRun({ message, projectRoot }) { /* ... */ },
  afterToolExecution({ toolName, args, result, projectRoot }) { /* ... */ },
  onError({ error, projectRoot }) { /* ... */ },
  afterRun({ messages, projectRoot }) { /* ... */ }
};
```

---

## Briefings

Pre-loaded context scenarios in `.flowboard/briefings/`:

```markdown
<!-- .flowboard/briefings/payment-fix.md -->
# Fix Payment Module
Focus on Stripe integration in src/payments/.
The webhook handler is failing on refund events.
```

Load via `/api/briefings/load` or pass `briefing` param to `/api/agent/run`.

---

## Skills

### Sources (auto-scanned, cached 60s)
- `~/.kiro/skills/`
- `~/.claude/skills/`
- `~/.codex/skills/`
- `~/.flowboard/skills/`

### Format
```markdown
---
name: my-skill
description: Short description
---
Instructions for the agent here.
```

### Auto-Detection
Keywords in prompt → matched skill auto-selected. Examples:
- "landing page design" → `high-end-visual-design`
- "fix the bug" → `bugfix` preset
- "write tests" → `test` preset

### Slash Commands
`/skill-name prompt` in agent input forces a specific skill.

---

## Permission System

```
safe tools     → execute immediately
dangerous tools → show approval UI
auto-approve   → skip all approvals (Ctrl+Shift+A)
```

---

## Self-Improvement

The agent learns from experience across sessions:

### Error Learning
When a tool fails or LLM returns an error, the pattern is saved to `.flowboard/lessons.md` with an `[ERROR]` tag. On next run, these lessons are in context so the agent avoids the same mistake.

### Success Recording
When `task_complete` is called, the summary is saved with a `[SUCCESS]` tag. The agent can reference past successes to replicate effective approaches.

### Skill Generation
After solving a complex task well, the agent can call `save_skill` to create a reusable skill at `~/.flowboard/skills/<name>/SKILL.md`. This skill is then available for all future sessions via auto-detection or slash commands.

### Adaptive Context
Every session injects the last 1000 chars of lessons into the system prompt. The agent reads these before acting and adjusts strategy accordingly.

---

## Security

| Protection | Implementation |
|-----------|---------------|
| Path traversal | `resolvePath()` validates paths stay within project |
| Card ID | Sanitized to alphanumeric only |
| Project path | Must be absolute + existing directory |
| API keys | Masked in responses |
| Bash | Async spawn, 30s timeout, SIGTERM on abort |
| Output | Truncated to 10KB |
| Iterations | Max 25 per run |
| Parallel | Max 5 concurrent |
| Body | Express limit 10MB |

---

## Extending

### Add Tool
1. Add definition to `TOOL_DEFINITIONS` in `agent/tools.js`
2. Add permission in `PERMISSIONS`
3. Add `case` in `executeTool()` switch

### Add Skill
Create `~/.flowboard/skills/name/SKILL.md` with frontmatter.

### Add Hook
Create `.flowboard/hooks/name.js` exporting hook functions.

### Add Briefing
Create `.flowboard/briefings/name.md`.

### Add Knowledge
Place files in `.flowboard/knowledge/` or use `/api/knowledge/add`.
