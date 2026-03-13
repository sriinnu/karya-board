#!/usr/bin/env node
/**
 * Lightweight API smoke test for Karya.
 * I start an isolated API server and validate CRUD, search, pagination, and BOARD.md sync behavior.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API_HOST = '127.0.0.1';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEALTH_TIMEOUT_MS = 20_000;
const CORE_DB_MODULE_PATH = path.join(REPO_ROOT, 'packages/core/dist/db/index.js');

/**
 * Entrypoint for the smoke run.
 */
async function main() {
  await ensureCoreBuild();
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'karya-smoke-'));

  try {
    await runHealthySuite(path.join(tempRoot, 'healthy'));
    await runWarningSuite(path.join(tempRoot, 'warning'));
    console.log('Smoke checks passed: CRUD, search, pagination, and board-sync paths are healthy.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Ensures the compiled core DB module exists before smoke setup imports it.
 * I build the core package lazily so direct smoke runs stay honest on a clean checkout.
 */
async function ensureCoreBuild() {
  try {
    await access(CORE_DB_MODULE_PATH);
    return;
  } catch {
    // I build the core package only when its dist output is missing.
  }

  const logs = [];
  const child = spawn('pnpm', ['--filter', '@karya/core', 'run', 'build'], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => logs.push(`[stdout] ${String(chunk).trimEnd()}`));
  child.stderr.on('data', (chunk) => logs.push(`[stderr] ${String(chunk).trimEnd()}`));

  const [exitCode] = await once(child, 'exit');
  if (exitCode !== 0) {
    throw new Error(`Failed to build @karya/core for smoke checks.\n${logs.join('\n')}`);
  }
}

/**
 * Runs the smoke suite where BOARD.md regeneration should succeed.
 *
 * @param suiteDir - Isolated temp directory for this suite
 */
async function runHealthySuite(suiteDir) {
  const context = await createSuiteContext(suiteDir, false);
  const server = await startApiServer(context.configPath, context.port);

  try {
    const baseUrl = `http://${API_HOST}:${context.port}`;
    await assertProjectVisible(baseUrl, context.projectId, context.projectName);

    const createResult = await requestJson(baseUrl, '/api/issues', {
      method: 'POST',
      body: JSON.stringify({
        projectId: context.projectId,
        title: 'Smoke Healthy: Initial issue',
        description: 'I validate create and board sync.',
        priority: 'high',
        status: 'open',
      }),
    });
    assert(createResult.success === true, 'Expected create issue to succeed in healthy suite');
    assert(!createResult.warning, 'Did not expect board warning in healthy suite');

    await requestJson(baseUrl, '/api/issues', {
      method: 'POST',
      body: JSON.stringify({
        projectId: context.projectId,
        title: 'Smoke Healthy: Pagination anchor',
        priority: 'medium',
        status: 'open',
      }),
    });
    await requestJson(baseUrl, '/api/issues', {
      method: 'POST',
      body: JSON.stringify({
        projectId: context.projectId,
        title: 'Smoke Healthy: Will be deleted',
        priority: 'low',
        status: 'open',
      }),
    });

    const searched = await requestJson(
      baseUrl,
      '/api/issues?search=Initial%20issue&limit=10&offset=0'
    );
    assert(searched.success === true, 'Expected search query to succeed');
    assert(searched.totalCount >= 1, 'Expected search query to return at least one issue');
    const initialIssue = searched.issues.find((issue) =>
      issue.title.includes('Smoke Healthy: Initial issue')
    );
    assert(initialIssue, 'Expected to find the initial issue by search');

    const paged = await requestJson(baseUrl, '/api/issues?limit=1&offset=1');
    assert(paged.success === true, 'Expected paginated query to succeed');
    assert(Array.isArray(paged.issues), 'Expected paginated response to include issues');
    assert(paged.issues.length === 1, 'Expected limit=1 pagination to return one row');
    assert(
      typeof paged.totalCount === 'number' && paged.totalCount >= 3,
      'Expected pagination metadata totalCount >= 3'
    );

    const updated = await requestJson(baseUrl, `/api/issues/${encodeURIComponent(initialIssue.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Smoke Healthy: Updated issue',
        status: 'done',
      }),
    });
    assert(updated.success === true, 'Expected update issue to succeed');
    assert(!updated.warning, 'Did not expect board warning on healthy update');

    const deletionTarget = await requestJson(
      baseUrl,
      '/api/issues?search=Will%20be%20deleted&limit=10&offset=0'
    );
    assert(deletionTarget.success === true, 'Expected delete target lookup to succeed');
    assert(deletionTarget.totalCount >= 1, 'Expected delete target to exist');
    const deleteIssue = deletionTarget.issues[0];

    const deleted = await requestJson(baseUrl, `/api/issues/${encodeURIComponent(deleteIssue.id)}`, {
      method: 'DELETE',
    });
    assert(deleted.success === true, 'Expected delete issue to succeed');
    assert(!deleted.warning, 'Did not expect board warning on healthy delete');

    const afterDelete = await requestJson(
      baseUrl,
      '/api/issues?search=Will%20be%20deleted&limit=10&offset=0'
    );
    assert(afterDelete.success === true, 'Expected post-delete lookup to succeed');
    assert(afterDelete.totalCount === 0, 'Expected deleted issue to be absent from search results');

    const boardContent = await readFile(context.boardPath, 'utf-8');
    assert(
      boardContent.includes('Smoke Healthy: Updated issue'),
      'Expected BOARD.md to include the updated issue title'
    );
  } finally {
    await stopApiServer(server);
  }
}

/**
 * Runs the smoke suite where BOARD.md regeneration should fail and return a warning.
 *
 * @param suiteDir - Isolated temp directory for this suite
 */
async function runWarningSuite(suiteDir) {
  const context = await createSuiteContext(suiteDir, true);
  const server = await startApiServer(context.configPath, context.port);

  try {
    const baseUrl = `http://${API_HOST}:${context.port}`;
    await assertProjectVisible(baseUrl, context.projectId, context.projectName);

    const created = await requestJson(baseUrl, '/api/issues', {
      method: 'POST',
      body: JSON.stringify({
        projectId: context.projectId,
        title: 'Smoke Warning: Mutation still succeeds',
        priority: 'critical',
        status: 'open',
      }),
    });
    assert(created.success === true, 'Expected create to succeed even when BOARD sync fails');
    assert(
      typeof created.warning === 'string' && created.warning.length > 0,
      'Expected non-fatal BOARD sync warning on create'
    );

    const listed = await requestJson(
      baseUrl,
      '/api/issues?search=Mutation%20still%20succeeds&limit=10&offset=0'
    );
    assert(listed.success === true, 'Expected list query to succeed after warning mutation');
    assert(listed.totalCount >= 1, 'Expected issue to persist even with board warning');
  } finally {
    await stopApiServer(server);
  }
}

/**
 * Creates an isolated config + filesystem fixture for one suite.
 *
 * @param suiteDir - Suite root directory
 * @param breakBoardOutput - Whether to force board generation failure
 * @returns Isolated suite context
 */
async function createSuiteContext(suiteDir, breakBoardOutput) {
  await mkdir(suiteDir, { recursive: true });

  const projectPath = path.join(suiteDir, 'project');
  await mkdir(projectPath, { recursive: true });
  await writeFile(
    path.join(projectPath, 'README.md'),
    '# Smoke Fixture\n\n- [ ] This file gives me a predictable project root.\n',
    'utf-8'
  );

  const dbPath = path.join(suiteDir, 'karya.db');
  const boardPath = breakBoardOutput ? path.join(dbPath, 'BOARD.md') : path.join(suiteDir, 'BOARD.md');
  const configPath = path.join(suiteDir, 'karya.config.json');
  const port = await allocatePort();

  const projectName = breakBoardOutput ? 'smoke-warning-project' : 'smoke-healthy-project';
  const config = {
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
  };

  const projectId = await seedProjectDatabase(dbPath, {
    projectName,
    projectPath,
  });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  return { configPath, boardPath, port, projectId, projectName };
}

/**
 * Starts the local API server process and waits for health to become ready.
 *
 * @param configPath - Config file for this run
 * @param port - Port to bind
 * @returns Started process state
 */
async function startApiServer(configPath, port) {
  const logs = [];
  const child = spawn('pnpm', ['api:start'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      KARYA_CONFIG: configPath,
      KARYA_API_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => logs.push(`[stdout] ${String(chunk).trimEnd()}`));
  child.stderr.on('data', (chunk) => logs.push(`[stderr] ${String(chunk).trimEnd()}`));

  try {
    await waitForHealth(`http://${API_HOST}:${port}/api/health`, HEALTH_TIMEOUT_MS);
  } catch (error) {
    const joinedLogs = logs.join('\n');
    throw new Error(
      `API server failed to become healthy: ${error instanceof Error ? error.message : String(error)}\n${joinedLogs}`
    );
  }

  return { child, logs, port };
}

/**
 * Stops a previously started API server process.
 *
 * @param server - Process state returned by startApiServer
 */
async function stopApiServer(server) {
  if (server.child.exitCode !== null || server.child.killed) {
    return;
  }

  server.child.kill('SIGTERM');
  await Promise.race([
    once(server.child, 'exit'),
    delay(5_000).then(() => {
      if (server.child.exitCode === null) {
        server.child.kill('SIGKILL');
      }
    }),
  ]);
}

/**
 * Waits for the API health endpoint to return success.
 *
 * @param url - Health URL
 * @param timeoutMs - Timeout budget
 */
async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        const body = await response.json();
        if (body?.success === true) {
          return;
        }
      }
    } catch {
      // I keep polling until the timeout budget is exhausted.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for health endpoint: ${url}`);
}

/**
 * Verifies that the seeded project is visible through `/api/projects`.
 *
 * @param baseUrl - API base URL
 * @param expectedProjectId - Seeded project ID
 * @param expectedProjectName - Seeded project name
 */
async function assertProjectVisible(baseUrl, expectedProjectId, expectedProjectName) {
  const projects = await requestJson(baseUrl, '/api/projects');
  assert(projects.success === true, 'Expected /api/projects to succeed');
  assert(Array.isArray(projects.projects), 'Expected /api/projects to return projects array');
  const project = projects.projects.find((entry) => entry.id === expectedProjectId);
  assert(project, 'Expected seeded project ID to be present in /api/projects');
  assert(
    project.name === expectedProjectName,
    'Expected seeded project name to be present in /api/projects'
  );
}

/**
 * Performs a JSON request against the local API.
 *
 * @param baseUrl - API base URL
 * @param pathnameAndQuery - Path and optional query
 * @param init - Fetch options
 * @returns Parsed JSON payload
 */
async function requestJson(baseUrl, pathnameAndQuery, init = {}) {
  const response = await fetch(`${baseUrl}${pathnameAndQuery}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json();
  if (!response.ok && payload?.success !== false) {
    throw new Error(`Unexpected HTTP ${response.status} for ${pathnameAndQuery}`);
  }

  return payload;
}

/**
 * Allocates an available local TCP port.
 *
 * @returns Available port number
 */
async function allocatePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, API_HOST, () => {
      const address = server.address();
      const port =
        address && typeof address === 'object' && typeof address.port === 'number'
          ? address.port
          : null;

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Failed to allocate free TCP port'));
          return;
        }
        resolve(port);
      });
    });
  });
}

/**
 * Throws when a required condition is not met.
 *
 * @param condition - Condition to verify
 * @param message - Failure reason
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Seeds one project row so the API can create issues without requiring scanner startup.
 *
 * @param dbPath - SQLite database path
 * @param seed - Seed values for the project row
 */
async function seedProjectDatabase(dbPath, seed) {
  const { Database } = await import(pathToFileURL(CORE_DB_MODULE_PATH).href);
  const db = new Database(dbPath);

  try {
    const initResult = db.initialize();
    if (!initResult.success) {
      throw new Error(`Failed to initialize smoke database: ${initResult.error.message}`);
    }

    const createResult = db.createProject(seed.projectName, seed.projectPath);
    if (!createResult.success) {
      throw new Error(`Failed to seed smoke project: ${createResult.error.message}`);
    }

    return createResult.data.id;
  } finally {
    db.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Smoke checks failed: ${message}`);
  process.exitCode = 1;
});
