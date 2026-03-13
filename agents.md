# agents.md - Instructions for AI Agents

This file documents how AI agents should interact with the Karya system.

## Overview

Karya is a local task board that generates a `BOARD.md` file. AI agents should:

1. **Read BOARD.md** at the start of each session to understand current tasks
2. **Update BOARD.md** by adding completed tasks and new discoveries
3. **Use MCP tools** when available for structured issue management

## Reading BOARD.md

When you start working in a project directory:

1. First check if `BOARD.md` exists in the project root
2. Parse the markdown to understand:
   - Current open issues by priority
   - Issues you're already working on
   - Recently completed work
3. Update your understanding of what needs to be done

## Writing to BOARD.md

When you complete a task or discover a new issue:

1. **Mark done items**: Change `- [ ]` to `- [x]`
2. **Add new items**: Insert new TODO items following the priority format
3. **Update status**: Note completed work in the appropriate section

Example:

```markdown
### 🔴 Critical
- [x] Fix SQLite vector memory leak  ← marked complete
- [ ] Add Tauri desktop app           ← new item added
```

## MCP Tool Usage

When the MCP server is running, prefer using tools over manual BOARD.md editing:

### Adding Issues

```
I found a memory leak in vaayu/src/memory.ts — add it to Karya
```

This triggers `add_issue` which:
- Creates the issue in SQLite
- Regenerates BOARD.md automatically

### Listing Issues

```
Show me all critical issues for the PAKT project
```

This triggers `list_issues` which returns structured data.

### Updating Issues

```
Mark that memory leak issue as done
```

This triggers `update_issue` and BOARD.md is regenerated.

## File Patterns That Generate Issues

Karya scans for these patterns:

| Pattern | Example | File Types |
|---------|---------|-------------|
| TODO checkbox | `- [ ] Do something` | .md files |
| FIXME comment | `// FIXME: Fix this` | Code files |
| TODO comment | `// TODO: Add feature` | Code files |
| HACK comment | `// HACK: Workaround` | Code files |

## Best Practices

1. **Start by reading BOARD.md** - Understand current state before making changes
2. **Update as you work** - Mark completed tasks, add new discoveries
3. **Use appropriate priorities** - Critical for bugs, high for important features
4. **Include source files** - When adding issues from code, reference the file
5. **Be concise** - BOARD.md should be scannable, not verbose

## Project Structure

If you need to modify Karya itself:

```
karya/
├── packages/core/       # Core logic (DB, scanner, board-gen)
├── packages/mcp/        # MCP server
├── apps/ui/            # Web interface
└── docs/               # Documentation
```

Follow the patterns in existing code:
- Strict TypeScript
- JSDoc on all exports
- Result<T> for error handling
- Proper locking for concurrent operations
