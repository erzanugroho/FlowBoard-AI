# Flowboard AI

Agentic AI Kanban Board — AI yang bisa membaca, menulis, dan mengeksekusi kode langsung dari kanban board.

## Quick Start

```bash
npm install
start.bat          # Windows (auto-opens browser)
# or
npm start          # Terminal
```

Buka http://localhost:3000

## Architecture

```
E:\KANBAN\
├── server.js                  # Express server — all API routes
├── agent/
│   ├── tools.js               # 25 tools + executor
│   ├── loop.js                # Agent loop (streaming, retry, undo, budget)
│   ├── skills.js              # Multi-source skill loader + auto-detection
│   ├── memory.js              # 3-layer memory system
│   ├── hooks.js               # Lifecycle hooks + briefings
│   └── mcp.js                 # MCP client (stdio + SSE)
├── public/
│   ├── index.html             # SPA shell
│   ├── style.css              # All styles (dark/light themes)
│   └── js/
│       ├── data.js            # Data models, helpers, constants
│       ├── app.js             # Main app controller
│       └── modules/
│           ├── icons.js       # Lucide icon system
│           ├── ui-utils.js    # Toast, command palette, resize, sound
│           ├── board.js       # Kanban board + drag-drop
│           ├── chat.js        # AI chat panel
│           ├── agent-panel.js # Agent panel (streaming, approval, undo, export)
│           ├── task-engine.js # Task state machine
│           ├── task-detail.js # Task detail drawer
│           ├── mission-control.js # Activity log
│           └── providers.js   # AI provider management
├── start.bat / stop.bat
├── package.json               # express only
└── docs/AGENT.md              # Agent system documentation
```

## Agent System

### Tools (26)

| Category | Tools | Permission |
|----------|-------|-----------|
| Shell | `bash` | dangerous |
| File Read | `read_file`, `file_info` | safe |
| File Write | `write_file`, `edit_file`, `multi_edit`, `insert_lines`, `patch` | dangerous |
| File Manage | `delete_file`, `rename_file`, `copy_file` | dangerous |
| Search | `grep`, `glob`, `ls`, `tree`, `find_definition` | safe |
| Network | `fetch_url`, `web_search` | safe |
| CI/CD | `run_tests`, `check_ci` | dangerous/safe |
| Memory | `memory_read`, `memory_write` | safe |
| Agent Control | `ask_user`, `spawn_subagent`, `save_skill`, `task_complete` | safe |

### Key Features

- **Streaming** — Token-by-token output display
- **Auto-retry** — Exponential backoff on 429/500 errors (3 retries)
- **Cancel mid-tool** — Abort kills running bash process immediately
- **Undo** — Revert all file changes from last agent run
- **Token budget** — Set max cost, agent auto-stops at limit
- **Subagent** — Delegate subtasks to child agents
- **Ask user** — Agent asks clarification mid-execution
- **Conversation branching** — Fork from any message
- **File watcher** — Detect external file changes
- **Export** — Download conversation as markdown report
- **Briefings** — Pre-loaded context scenarios
- **Lifecycle hooks** — Custom JS hooks (beforeRun, afterToolExecution, onError, afterRun)
- **Self-improvement** — Agent learns from errors, records successes, generates reusable skills

### Memory (3 layers)

| Layer | Storage | Purpose |
|-------|---------|---------|
| Project Memory | `.flowboard/memory.md` | Persistent facts, decisions, conventions |
| Knowledge Base | `.flowboard/knowledge/` | Reference files always in context |
| Card Memory | `.flowboard/agent-history/` | Per-task conversation history |

### Skills

Auto-loaded from: `~/.kiro/skills/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.flowboard/skills/`

- Auto-detection via keyword matching
- Slash commands (`/skill-name`) for manual selection
- Built-in presets: default, bugfix, feature, refactor, test

### Providers

OpenAI, Anthropic, DeepSeek, LM Studio (local), Ollama (local), any OpenAI-compatible endpoint.

## API Endpoints

### Agent Execution
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/run` | Start agent (SSE stream) |
| POST | `/api/agent/retry` | Retry with error context |
| POST | `/api/agent/run-parallel` | Run multiple tasks |
| POST | `/api/agent/approve` | Approve/deny tool |
| POST | `/api/agent/answer` | Answer ask_user question |
| POST | `/api/agent/abort` | Abort running agent |
| POST | `/api/agent/undo` | Revert file changes |
| POST | `/api/agent/export` | Export as markdown |
| POST | `/api/agent/fork` | Branch conversation |
| POST | `/api/agent/watch` | Start/stop file watcher |
| GET | `/api/agent/presets` | List presets + skills |
| POST | `/api/agent/estimate` | Cost estimation |
| GET | `/api/agent/file-changes` | File changes from last run |
| POST | `/api/agent/history/save` | Save card conversation |
| POST | `/api/agent/history/load` | Load card conversation |

### Memory & Knowledge
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/memory/read` | Read project memory |
| POST | `/api/memory/write` | Append to memory |
| POST | `/api/memory/reset` | Reset memory |
| POST | `/api/knowledge/list` | List knowledge files |
| POST | `/api/knowledge/add` | Add knowledge file |
| POST | `/api/knowledge/remove` | Remove knowledge file |

### Briefings
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/briefings/list` | List briefings |
| POST | `/api/briefings/load` | Load briefing |
| POST | `/api/briefings/save` | Save briefing |
| POST | `/api/briefings/delete` | Delete briefing |

### MCP
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/mcp/add` | Connect MCP server |
| POST | `/api/mcp/remove` | Disconnect |
| GET | `/api/mcp/tools` | List MCP tools |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+N` | New task |
| `Ctrl+O` | Open folder |
| `Ctrl+B` | Toggle AI panel |
| `Ctrl+Enter` | Send to agent |
| `Ctrl+.` | Abort agent |
| `Ctrl+Shift+A` | Toggle auto-approve |
| `Ctrl+R` | Retry agent |
| `Ctrl+Shift+R` | Run selected cards |
| `/` | Focus search |
| `?` | Show shortcuts |
| `Esc` | Close modal/panel |

## Security

- Path traversal protection on all file operations
- Card ID sanitized (alphanumeric only)
- Project path validated (absolute + exists)
- API keys masked in all responses
- Bash timeout 30s, output truncated 10KB
- Max 25 iterations, max 5 parallel, body limit 10MB

## Extending

**Add tool:** `agent/tools.js` → TOOL_DEFINITIONS + PERMISSIONS + case in executeTool()

**Add skill:** `~/.flowboard/skills/name/SKILL.md`

**Add hook:** `.flowboard/hooks/my-hook.js` exporting `{ beforeRun, afterToolExecution, onError, afterRun }`

**Add briefing:** `.flowboard/briefings/name.md`

**Add knowledge:** `.flowboard/knowledge/name.md`
