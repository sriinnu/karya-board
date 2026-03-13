/**
 * Board generator disposal tests.
 * I validate shutdown-facing behavior so the generator is safe during service termination.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BoardGenerator } from './index.js';
import { Database } from '../db/index.js';
import type { KaryaConfig } from '../db/models.js';

interface TestWorkspace {
  rootDir: string;
  boardPath: string;
  config: KaryaConfig;
  db: Database;
}

/**
 * Sleeps for the given amount of milliseconds.
 * I use this for deterministic timer assertions in debounce/dispose tests.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates an isolated board-generation workspace with a fresh database.
 */
function createWorkspace(debounceMs = 80): TestWorkspace {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karya-boardgen-test-'));
  const projectDir = path.join(rootDir, 'project');
  const dbPath = path.join(rootDir, 'karya.db');
  const boardPath = path.join(rootDir, 'BOARD.md');
  fs.mkdirSync(projectDir, { recursive: true });

  const config: KaryaConfig = {
    projects: [
      {
        name: 'board-project',
        path: projectDir,
        include: ['**/*.ts'],
        exclude: [],
      },
    ],
    boardOutput: boardPath,
    scanDepth: 4,
    scanner: {
      debounceMs,
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

  const projectResult = db.createProject('board-project', projectDir);
  if (!projectResult.success) {
    throw projectResult.error;
  }

  return {
    rootDir,
    boardPath,
    config,
    db,
  };
}

/**
 * Cleans the temporary workspace and closes SQLite.
 */
function cleanupWorkspace(workspace: TestWorkspace): void {
  workspace.db.close();
  fs.rmSync(workspace.rootDir, { recursive: true, force: true });
}

test('BoardGenerator returns a disposed error result after dispose', async () => {
  const workspace = createWorkspace();
  try {
    const generator = new BoardGenerator({ db: workspace.db, config: workspace.config });
    await generator.dispose();

    const result = await generator.regenerate();
    assert.equal(result.success, false);
    assert.match(result.error?.message ?? '', /disposed/i);
  } finally {
    cleanupWorkspace(workspace);
  }
});

test('BoardGenerator dispose cancels pending debounced regeneration', async () => {
  const workspace = createWorkspace(120);
  try {
    const generator = new BoardGenerator({ db: workspace.db, config: workspace.config });

    generator.scheduleRegenerate();
    await generator.dispose();
    await sleep(180);

    assert.equal(
      fs.existsSync(workspace.boardPath),
      false,
      'I expect no BOARD.md write after dispose cancels pending timer work'
    );
  } finally {
    cleanupWorkspace(workspace);
  }
});

test('BoardGenerator dispose waits for in-flight write completion', async () => {
  const workspace = createWorkspace();
  try {
    const generator = new BoardGenerator({ db: workspace.db, config: workspace.config });
    let writeStarted = false;
    let writeFinished = false;

    // I stub writeBoardFile to create a measurable in-flight write window.
    (generator as unknown as { writeBoardFile: () => Promise<unknown> }).writeBoardFile =
      async () => {
        writeStarted = true;
        await sleep(70);
        writeFinished = true;
        return {
          success: true,
          filePath: workspace.boardPath,
          projectCount: 1,
          issueCount: 0,
        };
      };

    const regenPromise = generator.regenerate();
    await sleep(15);
    assert.equal(writeStarted, true);

    const startedAt = Date.now();
    await generator.dispose();
    const elapsedMs = Date.now() - startedAt;

    assert.equal(writeFinished, true);
    assert.ok(elapsedMs >= 45, `I expect dispose to wait for active write completion, got ${elapsedMs}ms`);

    const result = await regenPromise;
    assert.equal((result as { success: boolean }).success, true);
  } finally {
    cleanupWorkspace(workspace);
  }
});
