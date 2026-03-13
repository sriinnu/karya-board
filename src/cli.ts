#!/usr/bin/env node
/**
 * CLI Entry Point for Karya
 * Provides a command-line interface matching the web UI functionality.
 * @packageDocumentation
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { Database, createBoardGenerator, createScanner, type Issue } from '@karya/core';
import type { KaryaConfig, IssuePriority, IssueStatus } from '@karya/core';

/**
 * Loads configuration from karya.config.json
 * @internal
 */
function loadConfig(configPath: string = './karya.config.json'): KaryaConfig {
  const resolvedConfigPath = path.resolve(configPath);

  if (!existsSync(resolvedConfigPath)) {
    console.error(`Config file not found: ${configPath}`);
    console.log('Creating default config...');
    const defaultConfig: KaryaConfig = {
      projects: [],
      boardOutput: './BOARD.md',
      scanDepth: 3,
      scanner: { debounceMs: 500, fileSizeLimitMb: 10 },
      database: { path: './karya.db' },
    };
    return defaultConfig;
  }

  const content = readFileSync(resolvedConfigPath, 'utf-8');
  const parsed = JSON.parse(content) as KaryaConfig;
  const configDir = path.dirname(resolvedConfigPath);

  return {
    ...parsed,
    boardOutput: resolveConfigPath(parsed.boardOutput, configDir),
    database: {
      ...parsed.database,
      path: resolveConfigPath(parsed.database.path, configDir),
    },
    projects: parsed.projects.map((project) => ({
      ...project,
      path: resolveConfigPath(project.path, configDir),
    })),
  };
}

/**
 * Resolves config-relative paths against the config file location.
 * @param value - Configured path
 * @param configDir - Directory containing the config file
 * @returns Absolute filesystem path
 * @internal
 */
function resolveConfigPath(value: string, configDir: string): string {
  return path.isAbsolute(value) ? value : path.resolve(configDir, value);
}

/**
 * Print a horizontal line
 * @internal
 */
function printLine(char: string = '─', length: number = 60): void {
  console.log(char.repeat(length));
}

/**
 * Print section header
 * @internal
 */
function printHeader(text: string): void {
  console.log();
  printLine('═');
  console.log(`  ${text}`);
  printLine('═');
}

/**
 * Print issue in list format
 * @internal
 */
function printIssue(issue: Issue, projectName: string): void {
  const statusIcon = issue.status === 'done' ? '✓' : issue.status === 'in_progress' ? '◐' : '○';
  const priorityIcon = issue.priority === 'critical' ? '🔴' :
                      issue.priority === 'high' ? '🟠' :
                      issue.priority === 'medium' ? '🟡' : '🟢';

  console.log(`  ${statusIcon} ${priorityIcon} ${issue.title}`);
  console.log(`      [${projectName}] ${issue.status} | ${issue.priority}`);
  if (issue.sourceFile) {
    console.log(`      Source: ${issue.sourceFile}`);
  }
}

/**
 * List all issues
 * @internal
 */
async function cmdList(args: string[], db: Database): Promise<void> {
  const options = {
    project: args.includes('--project') ? args[args.indexOf('--project') + 1] : undefined,
    status: args.includes('--status') ? args[args.indexOf('--status') + 1] as IssueStatus : undefined,
    priority: args.includes('--priority') ? args[args.indexOf('--priority') + 1] as IssuePriority : undefined,
  };

  const projects = db.getAllProjects();
  const projectMap = new Map(projects.map(p => [p.id, p.name]));

  let issues: Issue[] = [];

  if (options.project) {
    const proj = projects.find(p => p.name.toLowerCase() === options.project!.toLowerCase());
    if (proj) {
      issues = db.getIssuesByProject(proj.id);
    } else {
      throw new Error(`Project not found: ${options.project}`);
    }
  } else {
    for (const project of projects) {
      issues = issues.concat(db.getIssuesByProject(project.id));
    }
  }

  // Filter
  if (options.status) {
    issues = issues.filter(i => i.status === options.status);
  }
  if (options.priority) {
    issues = issues.filter(i => i.priority === options.priority);
  }

  printHeader(`Issues (${issues.length})`);

  if (issues.length === 0) {
    console.log('  No issues found');
    return;
  }

  // Group by priority
  const groups: Record<string, Issue[]> = { critical: [], high: [], medium: [], low: [], done: [] };
  for (const issue of issues) {
    if (issue.status === 'done') groups.done.push(issue);
    else groups[issue.priority].push(issue);
  }

  for (const priority of ['critical', 'high', 'medium', 'low']) {
    if (groups[priority].length > 0) {
      console.log(`\n  ${priority.toUpperCase()} (${groups[priority].length})`);
      for (const issue of groups[priority]) {
        printIssue(issue, projectMap.get(issue.projectId) || 'Unknown');
      }
    }
  }

  if (groups.done.length > 0) {
    console.log(`\n  DONE (${groups.done.length})`);
    for (const issue of groups.done) {
      printIssue(issue, projectMap.get(issue.projectId) || 'Unknown');
    }
  }
}

/**
 * Add a new issue
 * @internal
 */
async function cmdAdd(args: string[], db: Database): Promise<void> {
  const projectIdx = args.indexOf('--project');
  const titleIdx = args.indexOf('--title');
  const descIdx = args.indexOf('--description');
  const priorityIdx = args.indexOf('--priority');
  const statusIdx = args.indexOf('--status');
  const sourceIdx = args.indexOf('--source');

  if (projectIdx === -1 || titleIdx === -1) {
    throw new Error(
      [
        'Usage: karya add --project <name> --title <title> [options]',
        '  --project <name>     Project name (required)',
        '  --title <title>      Issue title (required)',
        '  --description <text> Description (optional)',
        '  --priority <level>   Priority: low, medium, high, critical (default: medium)',
        '  --status <status>    Status: open, in_progress, done (default: open)',
        '  --source <source>    Source: manual, scanner, claude (default: manual)',
      ].join('\n')
    );
  }

  const projectName = args[projectIdx + 1];
  const title = args[titleIdx + 1];
  const description = descIdx !== -1 ? args[descIdx + 1] : undefined;
  const priority = priorityIdx !== -1 ? args[priorityIdx + 1] as IssuePriority : 'medium';
  const status = statusIdx !== -1 ? args[statusIdx + 1] as IssueStatus : 'open';
  const source = sourceIdx !== -1 ? args[sourceIdx + 1] as 'manual' | 'scanner' | 'claude' : 'manual';

  const projects = db.getAllProjects();
  const project = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());

  if (!project) {
    throw new Error(`Project not found: ${projectName}\nAvailable projects: ${projects.map(p => p.name).join(', ')}`);
  }

  const result = db.createIssue({
    projectId: project.id,
    title,
    description,
    priority,
    status,
    source,
  });

  if (result.success) {
    console.log(`✓ Created issue: ${result.data.id}`);
    return;
  }

  throw new Error(`Failed to create issue: ${result.error.message}`);
}

/**
 * Update an issue
 * @internal
 */
async function cmdUpdate(args: string[], db: Database): Promise<void> {
  const idIdx = args.indexOf('--id');
  const titleIdx = args.indexOf('--title');
  const descIdx = args.indexOf('--description');
  const statusIdx = args.indexOf('--status');
  const priorityIdx = args.indexOf('--priority');

  if (idIdx === -1) {
    throw new Error(
      [
        'Usage: karya update --id <id> [options]',
        '  --id <id>            Issue ID (required)',
        '  --title <title>      New title (optional)',
        '  --description <text> New description (optional)',
        '  --status <status>    Status: open, in_progress, done',
        '  --priority <level>   Priority: low, medium, high, critical',
      ].join('\n')
    );
  }

  const issueId = args[idIdx + 1];
  const existing = db.getIssueById(issueId);

  if (!existing) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const updates: Parameters<typeof db.updateIssue>[1] = {};
  if (titleIdx !== -1) updates.title = args[titleIdx + 1];
  if (descIdx !== -1) updates.description = args[descIdx + 1];
  if (statusIdx !== -1) updates.status = args[statusIdx + 1] as IssueStatus;
  if (priorityIdx !== -1) updates.priority = args[priorityIdx + 1] as IssuePriority;

  const result = await db.write(async () => {
    return db.updateIssue(issueId, updates);
  });

  if (result.success) {
    console.log(`✓ Updated issue: ${issueId}`);
    return;
  }

  throw new Error(`Failed to update issue: ${result.error.message}`);
}

/**
 * Delete an issue
 * @internal
 */
async function cmdDelete(args: string[], db: Database): Promise<void> {
  const idIdx = args.indexOf('--id');

  if (idIdx === -1) {
    throw new Error('Usage: karya delete --id <id>');
  }

  const issueId = args[idIdx + 1];
  const existing = db.getIssueById(issueId);

  if (!existing) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const result = await db.write(async () => {
    return db.deleteIssue(issueId);
  });

  if (result.success) {
    console.log(`✓ Deleted issue: ${issueId}`);
    return;
  }

  throw new Error(`Failed to delete issue: ${result.error.message}`);
}

/**
 * List projects
 * @internal
 */
async function cmdProjects(db: Database): Promise<void> {
  const projects = db.getAllProjects();

  printHeader('Projects');

  if (projects.length === 0) {
    console.log('  No projects configured');
    return;
  }

  for (const project of projects) {
    const stats = db.getProjectStats(project.id);
    console.log(`\n  ${project.name}`);
    console.log(`    Path: ${project.path}`);
    console.log(`    Issues: ${stats.total} total | ${stats.open} open | ${stats.inProgress} in progress | ${stats.done} done`);
  }
}

/**
 * Generate BOARD.md
 * @internal
 */
async function cmdBoard(config: KaryaConfig, db: Database): Promise<void> {
  const generator = createBoardGenerator({ db, config });
  const result = await generator.regenerate();

  if (result.success) {
    console.log(`✓ Generated BOARD.md (${result.issueCount} issues from ${result.projectCount} projects)`);
    return;
  }

  throw new Error(`Failed to generate BOARD.md: ${result.error?.message ?? 'Unknown board generation error'}`);
}

/**
 * Run scanner
 * @internal
 */
async function cmdScan(config: KaryaConfig, db: Database): Promise<void> {
  console.log('Starting scanner...');

  const scanner = createScanner({ db, config });

  scanner.onScanEvent((event) => {
    console.log(`[Scanner] ${event.type}`, event.projectId ? `@${event.projectId}` : '');
  });

  await scanner.start();
  console.log('Scanner running. Press Ctrl+C to stop.');
}

/**
 * Show help
 * @internal
 */
function showHelp(): void {
  printHeader('Karya CLI');
  console.log(`
  Usage: karya <command> [options]

  Commands:
    list                    List all issues
    add                     Add a new issue
    update                  Update an issue
    delete                  Delete an issue
    projects                List projects
    board                   Generate BOARD.md
    scan                    Start file scanner
    help                    Show this help

  Examples:
    karya list --project myproject
    karya list --status open --priority high
    karya add --project myproject --title "Fix bug" --priority high
    karya update --id abc123 --status done
    karya delete --id abc123
    karya board
    karya scan
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  // Load config
  const configPath = args.includes('--config') ?
    args[args.indexOf('--config') + 1] : './karya.config.json';
  const config = loadConfig(configPath);

  // Initialize database
  const db = new Database(config.database.path);
  const initResult = db.initialize();

  if (!initResult.success) {
    console.error(`Failed to initialize database: ${initResult.error.message}`);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list':
        await cmdList(args.slice(1), db);
        break;
      case 'add':
        await cmdAdd(args.slice(1), db);
        await cmdBoard(config, db);
        break;
      case 'update':
        await cmdUpdate(args.slice(1), db);
        await cmdBoard(config, db);
        break;
      case 'delete':
        await cmdDelete(args.slice(1), db);
        await cmdBoard(config, db);
        break;
      case 'projects':
        await cmdProjects(db);
        break;
      case 'board':
        await cmdBoard(config, db);
        break;
      case 'scan':
        await cmdScan(config, db);
        break;
      case 'help':
        showHelp();
        break;
      default:
        showHelp();
        process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
