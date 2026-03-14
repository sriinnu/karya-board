# Karya Skill Definition

This file defines the Karya skill for AI agents and tools like OpenClaw.

## Skill Name

`karya`

## Description

Karya is a local AI-powered task board that scans codebases for TODO comments, FIXME markers, and markdown TODO files. It stores issues in a local SQLite database and generates a BOARD.md file that any AI can read.

## Use Cases

1. **Track tasks during development** - AI automatically creates issues from TODO comments found in code
2. **Manage project backlog** - Add, update, list, and delete issues via natural language
3. **Generate readable task board** - Creates BOARD.md for human-readable task overview
4. **Cross-AI coordination** - Multiple AI agents can coordinate through shared task board

## Commands

### List Issues

```
list issues for <project>
list all open issues
list critical issues
```

**Parameters:**
- `project` (optional): Filter by project name
- `status` (optional): open, in_progress, done
- `priority` (optional): low, medium, high, critical

**Returns:** Formatted list of issues with status, priority, and source

### Add Issue

```
add issue: <title>
add issue <title> to <project>
add issue: <title> priority: high
```

**Parameters:**
- `title` (required): Issue title
- `project` (required): Project name from config
- `description` (optional): Detailed description
- `priority` (optional): low, medium, high, critical (default: medium)
- `status` (optional): open, in_progress, done (default: open)
- `source` (optional): manual, scanner, claude (default: claude, which is the current AI-created source marker)

**Returns:** Confirmation with issue ID

### Update Issue

```
mark issue <id> as done
update issue <id> priority to high
update issue <id> status to in_progress
```

**Parameters:**
- `id` (required): Issue ID
- `title` (optional): New title
- `description` (optional): New description
- `status` (optional): open, in_progress, done
- `priority` (optional): low, medium, high, critical

**Returns:** Confirmation with updated issue details

### Delete Issue

```
delete issue <id>
remove issue <id>
```

**Parameters:**
- `id` (required): Issue ID

**Returns:** Confirmation of deletion

### Generate Board

```
generate board
regenerate board.md
```

**Parameters:** None

**Returns:** Confirmation with issue count

### Start Scanner

```
start scanner
scan projects
```

**Parameters:** None (uses config)

**Returns:** Scanner status

## Implementation

### MCP Tools

When using any MCP-enabled client or CLI, these tools are available:

```json
{
  "tools": [
    {
      "name": "karya_add_issue",
      "description": "Add a new issue to the Karya task board",
      "inputSchema": {
        "type": "object",
        "properties": {
          "project": { "type": "string", "description": "Project name" },
          "title": { "type": "string", "description": "Issue title" },
          "description": { "type": "string" },
          "priority": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
          "status": { "type": "string", "enum": ["open", "in_progress", "done"] },
          "sourceFile": { "type": "string", "description": "Source file path" }
        },
        "required": ["project", "title"]
      }
    },
    {
      "name": "karya_list_issues",
      "description": "List issues from the task board",
      "inputSchema": {
        "type": "object",
        "properties": {
          "project": { "type": "string" },
          "status": { "type": "string", "enum": ["open", "in_progress", "done"] },
          "priority": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
          "limit": { "type": "number", "default": 50 }
        }
      }
    },
    {
      "name": "karya_update_issue",
      "description": "Update an existing issue",
      "inputSchema": {
        "type": "object",
        "properties": {
          "issueId": { "type": "string" },
          "title": { "type": "string" },
          "description": { "type": "string" },
          "status": { "type": "string", "enum": ["open", "in_progress", "done"] },
          "priority": { "type": "string", "enum": ["low", "medium", "high", "critical"] }
        },
        "required": ["issueId"]
      }
    },
    {
      "name": "karya_delete_issue",
      "description": "Delete an issue",
      "inputSchema": {
        "type": "object",
        "properties": {
          "issueId": { "type": "string" }
        },
        "required": ["issueId"]
      }
    }
  ]
}
```

### CLI Commands

```bash
# List issues
karya list --project myproject
karya list --status open --priority high

# Add issue
karya add --project myproject --title "Fix memory leak" --priority high

# Update issue
karya update --id abc123 --status done

# Delete issue
karya delete --id abc123

# Generate BOARD.md
karya board

# Start scanner
karya scan

# Show help
karya help
```

## Configuration

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
  "boardOutput": "./BOARD.md",
  "scanDepth": 3
}
```

## Board.md Format

The generated BOARD.md follows this structure:

```markdown
# KARYA BOARD
_Last updated: 2026-03-13 09:42_

## ProjectName
**Status:** 3 open | 1 in_progress | 0 critical

### 🔴 Critical
- [ ] Issue title (source file)

### 🟠 High
- [ ] Issue title

### 🟡 Medium
- [ ] Issue title

### 🟢 Low
- [ ] Issue title

### ✅ Done
- [x] Completed issue
```

## Priority Mapping

| Priority | Emoji | Use Case |
|----------|-------|----------|
| critical | 🔴 | Bugs, security issues, blockers |
| high | 🟠 | Important features, technical debt |
| medium | 🟡 | Normal tasks, improvements |
| low | 🟢 | Nice to have, documentation |

## Error Handling

- **Project not found**: Lists available projects
- **Issue not found**: Returns error with suggestion to list issues
- **Invalid status/priority**: Returns valid options
- **Database locked**: Retries 3x with exponential backoff

## Example Conversations

### Adding a found issue

```
User: I found a memory leak in src/memory.ts - add it to the board
Agent: (calls karya_add_issue with project=current, title="Memory leak in memory.ts", priority=high, sourceFile="src/memory.ts")
Result: ✓ Created issue: abc123
```

### Checking current tasks

```
User: What needs to be done for the auth system?
Agent: (calls karya_list_issues with project=auth)
Result: Shows all open issues for auth project grouped by priority
```

### Completing a task

```
User: I fixed that bug - mark it as done
Agent: (calls karya_update_issue with issueId=<recent>, status=done)
Result: ✓ Updated issue: <id>
```

## Requirements

- Node.js 20+
- SQLite (via better-sqlite3)
- Configuration file (karya.config.json)

## Installation

```bash
git clone https://github.com/yourusername/karya.git
cd karya
pnpm install
pnpm build
```

## Notes

- All data is stored locally - no cloud dependencies
- Multiple AI agents can coordinate through BOARD.md
- Scanner automatically extracts TODO/FIXME/HACK comments
- Changes trigger BOARD.md regeneration automatically
