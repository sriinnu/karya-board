# Spanda

<img src="docs/karya.svg" alt="Spanda" width="160" />

**The calm operating surface for your codebase.** Scan repos, track issues locally, and keep humans and AI agents aligned around one durable artifact: `BOARD.md`.

> **Naming** &mdash; `Karya` is the runtime (CLI, packages, config). `Spanda` is the product surface and UI.

---

## Quick Start

```bash
git clone https://github.com/sriinnu/karya-board.git
cd karya-board && pnpm install && pnpm build
pnpm start
```

That's it. `pnpm start` launches the API and UI together, auto-picks free ports, and opens the dashboard.

Open the URL printed by Vite (usually `http://127.0.0.1:9631`), then either:

- Click **Start Scanner** in the header to scan your codebase for TODOs, or
- Click **Manage Projects** in the sidebar to add projects from the UI

You can also add projects by creating a `karya.config.json` in the project root:

```json
{
  "projects": [
    {
      "name": "my-project",
      "path": "./my-project",
      "include": ["README.md", "TODO.md", "ARCHITECTURE.md"],
      "exclude": ["node_modules", ".git"]
    }
  ],
  "boardOutput": "./BOARD.md"
}
```

Or skip the config file entirely and add projects through the **Manage Projects** modal in the UI &mdash; it writes `karya.config.json` for you.

---

## What Ships

| Surface | Default | Purpose |
|---------|---------|---------|
| **Spanda UI** | `127.0.0.1:9631` | Browser dashboard &mdash; analytics, board, project management, AI review |
| **Karya API** | `127.0.0.1:9630` | HTTP backend for projects, issues, config, scanner, and AI |
| **Scanner** | embedded | File watcher that scans TODOs, updates SQLite, regenerates `BOARD.md` |
| **MCP Server** | stdio | Structured tools for any MCP-capable client |
| **AI Review** | opt-in | Suggest-only Anthropic and OpenAI lanes with human approval |

If ports `9630`/`9631` are occupied, the launcher auto-selects free alternatives and keeps the UI proxy aligned.

---

## Commands

| Command | Description |
|---------|-------------|
| `pnpm start` | **Recommended.** UI + API together (auto-selects ports) |
| `pnpm app:dev` | Same as `pnpm start` |
| `pnpm scanner:start` | Standalone scanner/watcher |
| `pnpm api:start` | Standalone HTTP API |
| `pnpm ui:dev` | Standalone Vite dev server |
| `pnpm mcp:start` | MCP server for Claude Code, Codex, etc. |
| `pnpm karya` | CLI entrypoint |
| `pnpm typecheck` | TypeScript validation |
| `pnpm build` | Full package build |
| `pnpm test` | Full test suite |
| `pnpm smoke` | API smoke tests |
| `pnpm verify` | Release gate (typecheck + build + test + smoke) |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd+K` or `?` | Open command palette (search actions, projects, filters) |
| `N` | New issue |
| `A` | AI review |
| `R` | Refresh board |
| `Cmd+.` | Toggle focus mode (hides sidebar, dashboard, marquee) |
| `Cmd/Ctrl+Click` | Multi-select issues for bulk actions |

---

## Managing Projects

Projects can be managed three ways:

1. **From the UI** &mdash; click **Manage Projects** in the sidebar or find it in the command palette. Add/remove projects, edit include/exclude patterns, or directly edit `karya.config.json` from a built-in editor.

2. **Config file** &mdash; edit `karya.config.json` directly. The scanner reads it on startup.

3. **API** &mdash; `POST /api/projects`, `PATCH /api/projects/:id`, `DELETE /api/projects/:id`.

The UI also includes a **File Reader** tab that can read any JSON, markdown, or config file within your configured project directories.

---

## Architecture

```
karya-board/
├── apps/ui/              Spanda web interface
├── packages/
│   ├── core/             DB, scanner, board generation, locking
│   └── mcp/              MCP server, HTTP routes, AI adapters
├── src/                  Root CLI
├── scripts/              Smoke and support scripts
├── karya.config.json     Local project config
└── BOARD.md              Generated issue board
```

- **`packages/core`** &mdash; system of record: scanning, SQLite persistence, write serialization, board generation.
- **`packages/mcp`** &mdash; automation surface: MCP tools, HTTP routes, AI-provider adapters, project CRUD, config persistence, file reader.
- **`apps/ui`** &mdash; the Spanda interface. Glass-morphic, Apple-inspired command center with Dynamic Island header, completion rings, priority bars, command palette, focus mode, and bulk actions.
- **`src/cli.ts`** &mdash; CLI surface for scripting and local workflows.

---

## HTTP API

### Issues
- `GET /api/issues` &mdash; list with filters (project, status, priority, search, pagination)
- `POST /api/issues` &mdash; create issue
- `PATCH /api/issues/:id` &mdash; update issue
- `DELETE /api/issues/:id` &mdash; delete issue

### Projects
- `GET /api/projects` &mdash; list all projects with stats, analytics, docs, scan settings
- `POST /api/projects` &mdash; add a new project
- `PATCH /api/projects/:id` &mdash; edit project name, path, or scan patterns
- `DELETE /api/projects/:id` &mdash; remove project from config
- `PATCH /api/projects/:id/scan-settings` &mdash; update include/exclude rules

### Config & Files
- `GET /api/config` &mdash; read raw `karya.config.json`
- `PUT /api/config` &mdash; write full `karya.config.json`
- `POST /api/files/read` &mdash; read a file from a project directory (restricted to configured paths, 2MB limit)

### Scanner
- `GET /api/scanner/status` &mdash; scanner running state
- `POST /api/scanner/start` &mdash; start embedded scanner
- `POST /api/scanner/restart` &mdash; restart scanner

### AI
- `GET /api/ai/status` &mdash; provider availability
- `POST /api/ai/suggest-issues` &mdash; generate suggestions (review-only, never auto-writes)

---

## MCP Tools

When the MCP server is running, any MCP-capable client can use:

- **`add_issue`** &mdash; create a new issue
- **`list_issues`** &mdash; query with filters
- **`update_issue`** &mdash; modify an existing issue
- **`delete_issue`** &mdash; remove an issue
- **`suggest_issues`** &mdash; AI review (never writes without human approval)

---

## AI Review

Two built-in provider lanes, both review-only:

| Provider | Env var | Default model |
|----------|---------|---------------|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| `openai` | `OPENAI_API_KEY` | `gpt-5.1` |

**Safety boundaries:** only project stats and issue summaries are sent to the model. Raw files are never included. Every suggestion requires explicit human approval before becoming a stored issue.

<details>
<summary>Runtime environment variables</summary>

```bash
export KARYA_AI_PROVIDER=openai          # default provider
export ANTHROPIC_MODEL=claude-sonnet-4-20250514
export OPENAI_MODEL=gpt-5.1
export OPENAI_BASE_URL=https://api.openai.com/v1

# Per-provider rate limiting and timeouts
export KARYA_ANTHROPIC_MAX_TOKENS=1200
export KARYA_ANTHROPIC_MAX_RETRIES=2
export KARYA_ANTHROPIC_TIMEOUT_MS=20000
export KARYA_ANTHROPIC_REQUEST_LIMIT=6
export KARYA_ANTHROPIC_REQUEST_WINDOW_MS=60000
export KARYA_OPENAI_MAX_TOKENS=1200
export KARYA_OPENAI_MAX_RETRIES=2
export KARYA_OPENAI_TIMEOUT_MS=20000
export KARYA_OPENAI_REQUEST_LIMIT=6
export KARYA_OPENAI_REQUEST_WINDOW_MS=60000
```

</details>

---

## Configuration

| Option | Type | Description |
|--------|------|-------------|
| `projects` | `array` | Monitored projects |
| `projects[].name` | `string` | Display name in UI |
| `projects[].path` | `string` | Root scan path |
| `projects[].include` | `string[]` | File include patterns |
| `projects[].exclude` | `string[]` | Directory/file exclude patterns |
| `boardOutput` | `string` | Output path for `BOARD.md` |
| `scanDepth` | `number` | Max directory depth |
| `scanner.debounceMs` | `number` | Debounce delay for file changes |
| `database.path` | `string` | SQLite file location |

---

## Production Notes

The build is hardened for local production use:

- Mutation success is not falsely downgraded to `500` when board sync later warns.
- Stale UI responses are suppressed instead of overwriting newer filter state.
- Scanner cleanup removes stale findings when files disappear.
- Debounced board generation is shutdown-safe.
- Provider failures fail closed when an unavailable AI lane is explicitly requested.
- File reader is sandboxed to configured project directories only.

---

## Development

```bash
pnpm typecheck && pnpm build && pnpm test && pnpm smoke
```

Or run the full release gate:

```bash
pnpm verify
```

**Requirements:** Node `>=20`, `pnpm@9`.

## License

MIT
