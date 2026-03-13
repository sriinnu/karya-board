# CLAUDE.md - Instructions for Claude Code

This file provides context and instructions for Claude Code when working with the Karya project.

## Project Overview

Karya is a local AI-powered task board that:
- Scans codebases for TODO comments and markdown TODO files
- Stores issues in a local SQLite database
- Generates a BOARD.md file that any AI can read
- Provides MCP tools for Claude Code integration

## Key Directories

- `packages/core/src/db/` - Database layer with SQLite and locking
- `packages/core/src/scanner/` - File scanner and watcher
- `packages/core/src/board-gen/` - BOARD.md generator
- `packages/mcp/src/tools/` - MCP tool handlers
- `apps/ui/` - React web interface

## Important Patterns

### Race Condition Handling

The codebase uses several patterns to prevent race conditions:

1. **Database writes are serialized** through a write queue (`packages/core/src/db/lock.ts`)
2. **File processing is debounced** per-file, not globally (`packages/core/src/scanner/watcher.ts`)
3. **BOARD.md generation uses a mutex** pattern to prevent concurrent writes

### Adding New Features

When adding new features:

1. Follow strict TypeScript with full type annotations
2. Add JSDoc comments to all exported functions
3. Use the `Result<T>` pattern for functions that can fail
4. Handle edge cases as documented in the plan (see below)

### Edge Cases to Handle

| Scenario | Handling |
|----------|----------|
| Missing config | Create default config with instructions |
| Project path doesn't exist | Log warning, skip, don't crash |
| Non-UTF8 file encoding | Skip with warning |
| File > 10MB | Skip with warning |
| SQLite locked | Retry 3x with exponential backoff |

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run development
pnpm dev

# Start scanner
pnpm scanner:start

# Start MCP server
pnpm mcp:start

# Type check
pnpm typecheck
```

## MCP Tools

The MCP server exposes three tools:

1. `add_issue` - Create a new issue
2. `list_issues` - List issues with filters
3. `update_issue` - Update an existing issue

When adding new MCP tools, follow the pattern in `packages/mcp/src/tools/`.

## Code Style

- Use strict TypeScript (`strict: true` in tsconfig)
- All exported functions must have JSDoc comments
- Use meaningful variable names
- Keep functions focused and small
- Use `Result<T>` for error handling, not exceptions

## Testing

When modifying core functionality:

1. Test concurrent operations don't corrupt data
2. Test edge cases with missing/invalid files
3. Test scanner handles all supported file types
4. Test MCP tools work with concurrent calls
