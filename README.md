# Spanda

Spanda is the calm operating surface for Karya, a local-first issue board that scans your repo, stores state in SQLite, regenerates `BOARD.md`, and exposes the same workflow through the web UI, CLI, HTTP API, and MCP tools.

![Spanda mark](docs/karya.svg)

`Karya` is still the runtime name in the codebase.
`Spanda` is the front-facing product surface and the main UI experience.
The CLI, package names, config file, and generated board continue to use `karya`.
Motion-ready logo variants also live in `docs/spanda-breathe.svg`, `docs/spanda-orbit.svg`, and `docs/spanda-signal.svg`.

## Why This Exists

- I keep humans and agents aligned around one durable task artifact: `BOARD.md`.
- I turn scanner findings, manual issue capture, and AI review into one local workflow.
- I keep writes explicit and reviewable instead of letting AI mutate your board silently.
- I stay local-first by default, so your issue data does not require a hosted backend.

## What Ships

- `Spanda UI`: the browser-based operating surface for reviewing, filtering, creating, and updating issues.
- `Karya runtime`: the scanner, SQLite model, board generator, and CLI.
- `HTTP API`: the UI-facing API, defaulting to `http://127.0.0.1:9630`.
- `MCP server`: structured tools for any MCP-capable client.
- `Native AI review`: suggest-only Anthropic and OpenAI lanes with explicit human approval before writes.

## Product Principles

- Local-first storage with SQLite.
- One generated board file that every agent can read.
- Human approval before AI-created issues.
- Production-friendly defaults instead of novelty abstractions.
- Clear failure behavior: non-fatal sync warnings stay warnings, not false mutation failures.

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/sriinnu/karya-board.git
cd karya-board
pnpm install
pnpm build
```

### 2. Add `karya.config.json`

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

### 3. Start the local app

```bash
pnpm app:dev
```

Then open the exact local URL printed by Vite. On a clean machine that is usually [http://127.0.0.1:9631](http://127.0.0.1:9631).
From there, click `Start Scanner` in the header. That starts the embedded scanner from the web UI and populates the dashboard.

### 4. Understand the local runtimes

| Runtime | Default | What it does |
| --- | --- | --- |
| Spanda UI | `127.0.0.1:9631` | Browser dashboard for analytics, docs, board flow, and AI review |
| Karya API | `127.0.0.1:9630` | HTTP backend used by the UI for projects, issues, AI, and scanner control |
| Scanner | no port | Embedded watcher/runtime that scans files, updates SQLite, and regenerates `BOARD.md` |

The API defaults to `127.0.0.1:9630`.
If `9630` or `9631` are busy, `pnpm app:dev` automatically picks the next free local ports and keeps the UI proxy aligned.
`GET /` on the API returns JSON, not a web page, so the browser should open the Vite URL rather than the API root.

If you prefer separate processes:

```bash
pnpm scanner:start
pnpm api:start
pnpm ui:dev
```

If you want the scanner outside the web-controlled runtime, `pnpm scanner:start` runs it directly as a watcher process.

If you want MCP tools for Claude Code, Codex, or another MCP-capable client:

```bash
pnpm mcp:start
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm app:dev` | Runs the API and the Spanda UI together, auto-selecting free local ports when `9630` or `9631` are occupied |
| `pnpm scanner:start` | Starts the scanner/watcher runtime |
| `pnpm api:start` | Starts the HTTP API on port `9630` by default |
| `pnpm ui:dev` | Starts the Vite UI |
| `pnpm mcp:start` | Starts the MCP server |
| `pnpm karya` | Runs the local CLI entrypoint |
| `pnpm typecheck` | Runs TypeScript checks across root and packages |
| `pnpm build` | Builds packages and the root CLI |
| `pnpm test` | Runs root, core, MCP, and UI tests |
| `pnpm smoke` | Runs the API smoke suite |
| `pnpm verify` | Runs the full local release gate |

## What Spanda Shows

The main Spanda surface is designed to feel like a composed operating console rather than a generic backlog page.
It keeps:

- the current workspace scope visible,
- scanner state and scanner start/restart control in the header,
- a sticky header that compresses into a tighter island while you scroll,
- issue lanes grouped by priority,
- search, filtering, and density controls close to the board,
- non-fatal sync warnings explicit,
- AI review in a separate approval-first flow.

The UI is intentionally light, glassy, and restrained. I keep it closer to an Apple-style productivity surface than a template dashboard.

## AI Review

Karya supports two built-in native provider lanes:

| Provider | Required env var | Default model |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| `openai` | `OPENAI_API_KEY` | `gpt-5.1` |

Optional runtime controls:

```bash
export KARYA_AI_PROVIDER=openai
export ANTHROPIC_MODEL=claude-sonnet-4-20250514
export OPENAI_MODEL=gpt-5.1
export OPENAI_BASE_URL=https://api.openai.com/v1
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

### AI Safety Boundaries

- I send project stats, issue summaries, the selected provider/model, and your optional prompt guidance.
- I do not send raw project files by default.
- I do not auto-create issues.
- I require human approval before any suggestion becomes a stored issue.

### AI HTTP Routes

- `GET /api/ai/status`
- `POST /api/ai/suggest-issues`

Example:

```bash
curl -X POST http://127.0.0.1:9630/api/ai/suggest-issues \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "your-project-id",
    "provider": "openai",
    "model": "gpt-5.1",
    "prompt": "Focus on missing reliability and test coverage work",
    "maxSuggestions": 4
  }'
```

## MCP Tools

When the MCP server is running, any MCP-capable client can use:

- `add_issue`
- `list_issues`
- `update_issue`
- `delete_issue`
- `suggest_issues`

The `suggest_issues` tool is review-only. It never writes to SQLite or regenerates `BOARD.md` without human approval.

## Configuration

| Option | Type | Description |
| --- | --- | --- |
| `projects` | `array` | List of monitored projects |
| `projects[].name` | `string` | Display name shown in the UI |
| `projects[].path` | `string` | Root path to scan |
| `projects[].include` | `string[]` | Include patterns for relevant files |
| `projects[].exclude` | `string[]` | Exclude patterns for directories or files |
| `boardOutput` | `string` | Output path for generated `BOARD.md` |
| `scanDepth` | `number` | Maximum directory depth |
| `scanner.debounceMs` | `number` | Scanner debounce delay |
| `database.path` | `string` | SQLite file location |

## Architecture

```text
karya/
├── apps/
│   └── ui/                 # Spanda web UI
├── packages/
│   ├── core/               # DB, scanner, board generation, runtime
│   └── mcp/                # MCP server and HTTP API
├── src/                    # Root CLI
├── scripts/                # Smoke and support scripts
├── karya.config.json       # Local project config
└── BOARD.md                # Generated issue board
```

### Package Responsibilities

- `packages/core`: the real system of record for scanning, issue persistence, locking, and board generation.
- `packages/mcp`: structured automation entrypoints, HTTP routes, and AI-provider adapters.
- `apps/ui`: the Spanda interface for humans.
- `src/cli.ts`: the root CLI surface for scripting and local flows.

## Production Notes

The current build is hardened for local production use:

- mutation success is not falsely downgraded to `500` when board sync later warns,
- stale UI responses are suppressed instead of overwriting newer filters,
- scanner cleanup removes stale findings when files disappear or become unreadable,
- debounced board generation is shutdown-safe,
- the add-issue modal and major board controls expose stronger accessibility semantics,
- provider failures fail closed when an unavailable AI lane is explicitly requested.

## Development

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm smoke
pnpm verify
```

`pnpm verify` is the release gate. It runs type checks, builds, tests, and smoke verification together.

## Notes

- Node `>=20` is required.
- `pnpm@9` is the expected package manager.
- The repository is still named `karya` even though the UI product surface is branded `Spanda`.

## License

MIT
