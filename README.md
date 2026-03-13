# Karya

A local AI-powered task board that reads your codebase and generates actionable tasks. One machine. Zero cloud. One `BOARD.md`. Every AI reads it.

![Karya](docs/karya.svg)

## Features

- **Automatic Scanning**: Scans your codebase for TODO comments, FIXME markers, and markdown TODO files
- **MCP Integration**: Exposes tools for Claude Code to add and manage issues directly
- **Local SQLite Database**: All data stored locally with no cloud dependencies
- **Race Condition Handling**: Robust handling of concurrent operations with proper locking
- **Cross-Platform**: Works on macOS, Linux, and Windows (with Tauri desktop app coming soon)

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/karya.git
cd karya

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Quick Start

1. Create a `karya.config.json` in your project:

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

2. Run the scanner:

```bash
pnpm scanner:start
```

3. Start the local HTTP API for the web UI:

```bash
pnpm api:start
```

4. Start the MCP server for Claude Code integration:

```bash
pnpm mcp:start
```

5. Open the web UI:

```bash
pnpm dev
```

For local UI + API development together:

```bash
pnpm app:dev
```

## Architecture

```
karya/
├── apps/
│   ├── ui/                    # Vite + React web UI
│   └── desktop/               # Tauri desktop app (coming soon)
├── packages/
│   ├── core/                  # Core business logic
│   │   ├── db/               # SQLite database layer
│   │   ├── scanner/          # File scanner and watcher
│   │   └── board-gen         # BOARD.md generator
│   └── mcp/                   # MCP server for Claude Code
├── karya.config.json          # Configuration file
└── BOARD.md                   # Generated task board
```

## Configuration

| Option | Type | Description |
|--------|------|-------------|
| `projects` | array | List of projects to monitor |
| `projects[].name` | string | Display name |
| `projects[].path` | string | Path to project directory |
| `projects[].include` | array | File patterns to include |
| `projects[].exclude` | array | File patterns to exclude |
| `boardOutput` | string | Path for BOARD.md output |
| `scanDepth` | number | Maximum directory depth (default: 3) |
| `scanner.debounceMs` | number | Debounce delay (default: 500) |
| `database.path` | string | SQLite database path |

## MCP Tools

When the MCP server is running, Claude Code can use these tools:

### add_issue

```typescript
add_issue({
  project: "my-project",
  title: "Fix memory leak",
  description: "Found in src/memory.ts",
  priority: "high"
})
```

### list_issues

```typescript
list_issues({
  project: "my-project",
  status: "open",
  priority: "high"
})
```

### update_issue

```typescript
update_issue({
  issueId: "abc123",
  status: "done"
})
```

### delete_issue

```typescript
delete_issue({
  issueId: "abc123"
})
```

## Development

```bash
# Run all packages in development mode
pnpm dev

# Run type checking
pnpm typecheck

# Run package and root CLI tests
pnpm test

# Run API smoke checks (CRUD/search/pagination/board sync)
# I build the required core dist artifact automatically when it is missing.
pnpm smoke

# Run the full local release gate
pnpm verify

# Run database migrations
pnpm db:migrate
```

## Release Hardening

I keep release automation in two layers:

- Local gate: `pnpm verify` runs typecheck, build, tests, then API smoke checks.
- CI gate: GitHub Actions runs the same sequence on every push and pull request in `.github/workflows/ci.yml`.

### Local Autonomous Loop

I keep a lightweight local verify watcher at `scripts/verify-watch.mjs`. It watches the repo, debounces change bursts, and reruns the verification command serially.

```bash
# Full gate on every change
node scripts/verify-watch.mjs

# Faster loop while iterating locally
node scripts/verify-watch.mjs --quick

# One-shot run for debugging watcher config
node scripts/verify-watch.mjs --once --command "pnpm verify"
```

By default I run `pnpm verify`. I ignore generated/noisy paths such as `.git`, `node_modules`, `dist`, and `coverage`.

The smoke suite runs without a browser and uses an isolated temp config/database so it does not mutate your project data. It validates:

- `/api/issues` create, update, and delete flows
- search and pagination query behavior
- successful BOARD.md regeneration path
- non-fatal warning path when BOARD.md regeneration fails after a successful mutation

## Tech Stack

| Concern | Technology |
|---------|------------|
| UI | React + TypeScript + Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Database | better-sqlite3 |
| File Watching | chokidar |
| MCP | @modelcontextprotocol/sdk |
| Desktop | Tauri (coming soon) |

## License

MIT
