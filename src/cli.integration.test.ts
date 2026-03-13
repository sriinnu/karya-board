/**
 * CLI integration tests for Karya.
 * I exercise the real CLI process against isolated filesystem fixtures.
 * @packageDocumentation
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Database } from '../packages/core/src/db/index.js';

/**
 * Result shape for one CLI process execution.
 * @internal
 */
interface CliRunResult {
  /** Process exit code. */
  exitCode: number | null;
  /** Combined stdout data as UTF-8 text. */
  stdout: string;
  /** Combined stderr data as UTF-8 text. */
  stderr: string;
}

/**
 * Integration suite for major CLI task flows.
 */
test('I run list/add/update/delete/board flows against isolated fixtures', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'karya-cli-integration-'));
  const workspacePath = path.join(fixtureRoot, 'workspace');
  const dbPath = path.join(fixtureRoot, 'karya.db');
  const boardPath = path.join(fixtureRoot, 'BOARD.md');
  const configPath = path.join(fixtureRoot, 'karya.config.json');
  const projectPath = path.join(workspacePath, 'sample-project');
  const projectName = 'sample-project';

  try {
    await mkdir(projectPath, { recursive: true });
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# Sample Project\n\nThis fixture is used for CLI integration tests.\n',
      'utf-8'
    );

    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          projects: [
            {
              name: projectName,
              path: projectPath,
              include: ['**/*'],
              exclude: ['node_modules', '.git'],
            },
          ],
          boardOutput: boardPath,
          scanDepth: 4,
          scanner: {
            debounceMs: 100,
            fileSizeLimitMb: 10,
          },
          database: {
            path: dbPath,
          },
        },
        null,
        2
      )}\n`,
      'utf-8'
    );

    // I seed one project row because the CLI add flow resolves project names from the database.
    const db = new Database(dbPath);
    const initResult = db.initialize();
    assert.equal(initResult.success, true, 'I expected fixture database initialization to succeed');

    const createProjectResult = db.createProject(projectName, projectPath);
    assert.equal(createProjectResult.success, true, 'I expected project seeding to succeed');
    db.close();

    const initialList = await runCliCommand(['list', '--config', configPath]);
    assert.equal(
      initialList.exitCode,
      0,
      `I expected list command to exit cleanly.\nstdout:\n${initialList.stdout}\nstderr:\n${initialList.stderr}`
    );
    assert.match(
      initialList.stdout,
      /No issues found/i,
      'I expected the first list command to show no issues'
    );

    const addResult = await runCliCommand([
      'add',
      '--project',
      projectName,
      '--title',
      'Integration issue',
      '--description',
      'I validate the CLI integration flow.',
      '--priority',
      'high',
      '--status',
      'open',
      '--config',
      configPath,
    ]);
    assert.equal(
      addResult.exitCode,
      0,
      `I expected add command to exit cleanly.\nstdout:\n${addResult.stdout}\nstderr:\n${addResult.stderr}`
    );
    assert.match(addResult.stdout, /Created issue:/, 'I expected add to report a created issue id');
    assert.match(addResult.stdout, /Generated BOARD\.md/, 'I expected add to regenerate BOARD.md');

    const issueIdMatch = addResult.stdout.match(/Created issue:\s+([A-Za-z0-9-]+)/);
    assert.ok(issueIdMatch, 'I expected add output to include a parseable issue id');
    const issueId = issueIdMatch[1];

    const listAfterAdd = await runCliCommand(['list', '--project', projectName, '--config', configPath]);
    assert.equal(
      listAfterAdd.exitCode,
      0,
      `I expected filtered list command to exit cleanly.\nstdout:\n${listAfterAdd.stdout}\nstderr:\n${listAfterAdd.stderr}`
    );
    assert.match(
      listAfterAdd.stdout,
      /Integration issue/,
      'I expected list to include the issue added through CLI'
    );

    const updateResult = await runCliCommand([
      'update',
      '--id',
      issueId,
      '--status',
      'done',
      '--title',
      'Integration issue updated',
      '--config',
      configPath,
    ]);
    assert.equal(
      updateResult.exitCode,
      0,
      `I expected update command to exit cleanly.\nstdout:\n${updateResult.stdout}\nstderr:\n${updateResult.stderr}`
    );
    assert.match(updateResult.stdout, /Updated issue:/, 'I expected update to report success');
    assert.match(
      updateResult.stdout,
      /Generated BOARD\.md/,
      'I expected update to regenerate BOARD.md'
    );

    const boardResult = await runCliCommand(['board', '--config', configPath]);
    assert.equal(
      boardResult.exitCode,
      0,
      `I expected board command to exit cleanly.\nstdout:\n${boardResult.stdout}\nstderr:\n${boardResult.stderr}`
    );
    assert.match(boardResult.stdout, /Generated BOARD\.md/, 'I expected board command to report success');

    const boardContent = await readFile(boardPath, 'utf-8');
    assert.match(
      boardContent,
      /Integration issue updated/,
      'I expected generated BOARD.md to include the updated issue title'
    );

    const deleteResult = await runCliCommand([
      'delete',
      '--id',
      issueId,
      '--config',
      configPath,
    ]);
    assert.equal(
      deleteResult.exitCode,
      0,
      `I expected delete command to exit cleanly.\nstdout:\n${deleteResult.stdout}\nstderr:\n${deleteResult.stderr}`
    );
    assert.match(deleteResult.stdout, /Deleted issue:/, 'I expected delete to report success');
    assert.match(
      deleteResult.stdout,
      /Generated BOARD\.md/,
      'I expected delete to regenerate BOARD.md'
    );

    const finalList = await runCliCommand(['list', '--config', configPath]);
    assert.equal(
      finalList.exitCode,
      0,
      `I expected final list command to exit cleanly.\nstdout:\n${finalList.stdout}\nstderr:\n${finalList.stderr}`
    );
    assert.match(finalList.stdout, /No issues found/i, 'I expected no issues after deletion');

    const failedAdd = await runCliCommand([
      'add',
      '--project',
      'missing-project',
      '--title',
      'Should not persist',
      '--config',
      configPath,
    ]);
    assert.notEqual(
      failedAdd.exitCode,
      0,
      `I expected invalid add command to fail.\nstdout:\n${failedAdd.stdout}\nstderr:\n${failedAdd.stderr}`
    );
    assert.match(failedAdd.stderr, /Project not found: missing-project/);
    const boardAfterFailure = await readFile(boardPath, 'utf-8');
    assert.doesNotMatch(boardAfterFailure, /Should not persist/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

/**
 * Executes the CLI as a subprocess.
 * I run through the real entrypoint so option parsing and command wiring are exercised end-to-end.
 *
 * @param args - CLI arguments after the entry script
 * @returns Process result containing exit code and output streams
 * @internal
 */
async function runCliCommand(args: string[]): Promise<CliRunResult> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const nodeArgs = await resolveCliNodeArgs(repoRoot, args);

  return await new Promise<CliRunResult>((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Resolves the CLI entrypoint for integration tests.
 * I prefer the built CLI artifact when it exists, and I fall back to the source entry during quick local loops.
 *
 * @param repoRoot - Repository root path
 * @param args - CLI arguments
 * @returns Node invocation arguments
 * @internal
 */
async function resolveCliNodeArgs(repoRoot: string, args: string[]): Promise<string[]> {
  const builtCliPath = path.join(repoRoot, 'dist/cli.js');
  try {
    await access(builtCliPath);
    return [builtCliPath, ...args];
  } catch {
    const cliScriptPath = path.join(repoRoot, 'src/cli.ts');
    return ['--import', 'tsx', cliScriptPath, ...args];
  }
}
