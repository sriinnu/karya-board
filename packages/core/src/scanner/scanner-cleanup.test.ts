/**
 * Scanner cleanup tests.
 * I verify scanner-owned artifacts and issues are cleaned up on unlink and parse-failure paths.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Database } from '../db/index.js';
import type { KaryaConfig } from '../db/models.js';
import { Scanner, type ScanEvent } from './index.js';

interface ScannerInternals {
  /**
   * Private scanner hook used to simulate watcher events directly.
   */
  handleFileEvent: (
    projectId: string,
    event: { type: 'add' | 'change' | 'unlink'; filePath: string; relativePath: string }
  ) => Promise<void>;
}

interface TestWorkspace {
  rootDir: string;
  projectDir: string;
  config: KaryaConfig;
  db: Database;
  projectId: string;
}

/**
 * Creates an isolated temporary workspace with a fresh SQLite database.
 * I keep each test isolated so race conditions and stale rows cannot leak between cases.
 */
function createWorkspace(): TestWorkspace {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karya-scanner-test-'));
  const projectDir = path.join(rootDir, 'project');
  const dbPath = path.join(rootDir, 'karya.db');
  const boardPath = path.join(rootDir, 'BOARD.md');
  fs.mkdirSync(projectDir, { recursive: true });

  const config: KaryaConfig = {
    projects: [
      {
        name: 'test-project',
        path: projectDir,
        include: ['**/*.ts'],
        exclude: [],
      },
    ],
    boardOutput: boardPath,
    scanDepth: 5,
    scanner: {
      debounceMs: 25,
      fileSizeLimitMb: 2,
    },
    database: {
      path: dbPath,
    },
  };

  const db = new Database(dbPath);
  const initResult = db.initialize();
  if (!initResult.success) {
    throw initResult.error;
  }

  const projectResult = db.createProject('test-project', projectDir);
  if (!projectResult.success) {
    throw projectResult.error;
  }

  return {
    rootDir,
    projectDir,
    config,
    db,
    projectId: projectResult.data.id,
  };
}

/**
 * Removes temporary test files and closes the open database handle.
 */
function cleanupWorkspace(workspace: TestWorkspace): void {
  workspace.db.close();
  fs.rmSync(workspace.rootDir, { recursive: true, force: true });
}

test('Scanner removes scanner artifacts and issues on unlink events', async () => {
  const workspace = createWorkspace();
  try {
    const sourceFile = path.join(workspace.projectDir, 'unlink-target.ts');
    fs.writeFileSync(sourceFile, '// TODO: remove me\n', 'utf-8');

    const artifactResult = workspace.db.upsertArtifact({
      projectId: workspace.projectId,
      filePath: sourceFile,
      content: '// TODO: remove me\n',
    });
    assert.equal(artifactResult.success, true);

    const issueResult = workspace.db.createIssue({
      projectId: workspace.projectId,
      title: 'unlink cleanup issue',
      source: 'scanner',
      sourceFile,
      priority: 'high',
    });
    assert.equal(issueResult.success, true);
    assert.equal(workspace.db.getArtifactsByProject(workspace.projectId).length, 1);
    assert.equal(workspace.db.getIssuesByProject(workspace.projectId).length, 1);

    const scanner = new Scanner({ db: workspace.db, config: workspace.config });
    const events: ScanEvent[] = [];
    scanner.onScanEvent((event) => {
      events.push(event);
    });

    await (scanner as unknown as ScannerInternals).handleFileEvent(workspace.projectId, {
      type: 'unlink',
      filePath: sourceFile,
      relativePath: 'unlink-target.ts',
    });

    assert.equal(workspace.db.getArtifactsByProject(workspace.projectId).length, 0);
    assert.equal(workspace.db.getIssuesByProject(workspace.projectId).length, 0);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'file-change' &&
          event.projectId === workspace.projectId &&
          event.issueCount === 0
      ),
      'I expect an explicit file-change event with issueCount=0 after unlink cleanup'
    );
  } finally {
    cleanupWorkspace(workspace);
  }
});

test('Scanner clears stale scanner state when parse fails on change events', async () => {
  const workspace = createWorkspace();
  try {
    const sourceFile = path.join(workspace.projectDir, 'missing-on-change.ts');

    const artifactResult = workspace.db.upsertArtifact({
      projectId: workspace.projectId,
      filePath: sourceFile,
      content: '// TODO: stale scanner content\n',
    });
    assert.equal(artifactResult.success, true);

    const issueResult = workspace.db.createIssue({
      projectId: workspace.projectId,
      title: 'stale parse-failure issue',
      source: 'scanner',
      sourceFile,
      priority: 'critical',
    });
    assert.equal(issueResult.success, true);
    assert.equal(workspace.db.getArtifactsByProject(workspace.projectId).length, 1);
    assert.equal(workspace.db.getIssuesByProject(workspace.projectId).length, 1);

    const scanner = new Scanner({ db: workspace.db, config: workspace.config });
    const events: ScanEvent[] = [];
    scanner.onScanEvent((event) => {
      events.push(event);
    });

    await (scanner as unknown as ScannerInternals).handleFileEvent(workspace.projectId, {
      type: 'change',
      filePath: sourceFile,
      relativePath: 'missing-on-change.ts',
    });

    assert.equal(workspace.db.getArtifactsByProject(workspace.projectId).length, 0);
    assert.equal(workspace.db.getIssuesByProject(workspace.projectId).length, 0);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'db-updated' &&
          event.projectId === workspace.projectId &&
          event.issueCount === 0
      ),
      'I expect a db-updated event with issueCount=0 after parse-failure cleanup'
    );
  } finally {
    cleanupWorkspace(workspace);
  }
});
