/**
 * Integration tests for the MCP HTTP server contract.
 * I verify non-fatal board sync warnings on successful mutations and SQL-backed list query behavior.
 * @packageDocumentation
 */

import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Database, type KaryaConfig } from '@karya/core';
import { KaryaApiServer } from './http.js';

interface TestFixture {
  /** Temp root directory for the test run */
  tempRoot: string;
  /** Server under test */
  server: KaryaApiServer;
  /** Base URL for HTTP requests */
  baseUrl: string;
  /** Config used by the server */
  config: KaryaConfig;
  /** Primary project ID */
  primaryProjectId: string;
  /** Secondary project ID */
  secondaryProjectId: string;
}

interface MutationPayload {
  success: boolean;
  issueId?: string;
  warning?: string;
  error?: string;
}

interface IssuesPayload {
  success: boolean;
  issues: Array<{
    id: string;
    projectId: string;
    title: string;
    status: string;
    priority: string;
  }>;
  totalCount: number;
  limit: number;
  offset: number;
  error?: string;
}

/**
 * Verifies successful mutations remain successful when BOARD sync fails.
 */
test('I return non-fatal warnings for successful mutations when board sync fails', async () => {
  const fixture = await createFixture({ failingBoardSync: true });

  try {
    const created = await requestJson<MutationPayload>(
      fixture.baseUrl,
      'POST',
      '/api/issues',
      {
        projectId: fixture.primaryProjectId,
        title: 'Alpha API mutation warning test',
        priority: 'high',
      }
    );
    assert.equal(created.status, 201);
    assert.equal(created.payload.success, true);
    assert.equal(typeof created.payload.issueId, 'string');
    assert.match(
      created.payload.warning ?? '',
      /mutation succeeded.*could not reflect the change in BOARD\.md/i
    );

    const issueId = created.payload.issueId as string;

    const updated = await requestJson<MutationPayload>(
      fixture.baseUrl,
      'PATCH',
      `/api/issues/${encodeURIComponent(issueId)}`,
      {
        status: 'done',
      }
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.payload.success, true);
    assert.match(
      updated.payload.warning ?? '',
      /mutation succeeded.*could not reflect the change in BOARD\.md/i
    );

    const deleted = await requestJson<MutationPayload>(
      fixture.baseUrl,
      'DELETE',
      `/api/issues/${encodeURIComponent(issueId)}`
    );
    assert.equal(deleted.status, 200);
    assert.equal(deleted.payload.success, true);
    assert.match(
      deleted.payload.warning ?? '',
      /mutation succeeded.*could not reflect the change in BOARD\.md/i
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

/**
 * Verifies query filtering and pagination for the list endpoint.
 */
test('I apply project, status, priority, search, limit, and offset filters on list queries', async () => {
  const fixture = await createFixture({ seedIssues: true });

  try {
    const baseParams = new URLSearchParams({
      projectId: fixture.primaryProjectId,
      status: 'open',
      priority: 'high',
      search: 'alpha',
      limit: '1',
    });

    const pageOne = await requestJson<IssuesPayload>(
      fixture.baseUrl,
      'GET',
      `/api/issues?${baseParams.toString()}&offset=0`
    );
    assert.equal(pageOne.status, 200);
    assert.equal(pageOne.payload.success, true);
    assert.equal(pageOne.payload.totalCount, 2);
    assert.equal(pageOne.payload.limit, 1);
    assert.equal(pageOne.payload.offset, 0);
    assert.equal(pageOne.payload.issues.length, 1);
    assert.equal(pageOne.payload.issues[0]?.projectId, fixture.primaryProjectId);
    assert.equal(pageOne.payload.issues[0]?.status, 'open');
    assert.equal(pageOne.payload.issues[0]?.priority, 'high');

    const pageTwo = await requestJson<IssuesPayload>(
      fixture.baseUrl,
      'GET',
      `/api/issues?${baseParams.toString()}&offset=1`
    );
    assert.equal(pageTwo.status, 200);
    assert.equal(pageTwo.payload.success, true);
    assert.equal(pageTwo.payload.totalCount, 2);
    assert.equal(pageTwo.payload.limit, 1);
    assert.equal(pageTwo.payload.offset, 1);
    assert.equal(pageTwo.payload.issues.length, 1);
    assert.equal(pageTwo.payload.issues[0]?.projectId, fixture.primaryProjectId);
    assert.equal(pageTwo.payload.issues[0]?.status, 'open');
    assert.equal(pageTwo.payload.issues[0]?.priority, 'high');
    assert.notEqual(pageOne.payload.issues[0]?.id, pageTwo.payload.issues[0]?.id);
  } finally {
    await cleanupFixture(fixture);
  }
});

/**
 * Creates a full API test fixture with isolated SQLite and project data.
 * @param options - Fixture behavior switches
 * @returns Initialized fixture
 * @internal
 */
async function createFixture(options?: {
  seedIssues?: boolean;
  failingBoardSync?: boolean;
}): Promise<TestFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'karya-mcp-test-'));
  const projectOnePath = path.join(tempRoot, 'project-one');
  const projectTwoPath = path.join(tempRoot, 'project-two');
  const dataDir = path.join(tempRoot, 'data');
  await mkdir(projectOnePath, { recursive: true });
  await mkdir(projectTwoPath, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const config: KaryaConfig = {
    boardOutput: path.join(tempRoot, 'BOARD.md'),
    scanDepth: 5,
    scanner: {
      debounceMs: 50,
      fileSizeLimitMb: 5,
    },
    database: {
      path: path.join(dataDir, 'karya.db'),
    },
    projects: [
      { name: 'Project One', path: projectOnePath },
      { name: 'Project Two', path: projectTwoPath },
    ],
  };

  const seedDb = new Database(config.database.path);
  const init = seedDb.initialize();
  assert.equal(init.success, true);

  const primaryProject = seedDb.createProject('Project One', projectOnePath);
  assert.equal(primaryProject.success, true);

  const secondaryProject = seedDb.createProject('Project Two', projectTwoPath);
  assert.equal(secondaryProject.success, true);

  const primaryProjectId = primaryProject.data.id;
  const secondaryProjectId = secondaryProject.data.id;

  if (options?.seedIssues) {
    // I intentionally seed two matching issues so offset pagination can be asserted.
    const seeded = [
      seedDb.createIssue({
        projectId: primaryProjectId,
        title: 'Alpha service outage',
        description: 'alpha critical path',
        status: 'open',
        priority: 'high',
        source: 'manual',
      }),
      seedDb.createIssue({
        projectId: primaryProjectId,
        title: 'Alpha retries tuning',
        description: 'alpha latency work',
        status: 'open',
        priority: 'high',
        source: 'manual',
      }),
      seedDb.createIssue({
        projectId: primaryProjectId,
        title: 'Beta non-matching issue',
        description: 'beta',
        status: 'open',
        priority: 'medium',
        source: 'manual',
      }),
      seedDb.createIssue({
        projectId: primaryProjectId,
        title: 'Alpha already done',
        description: 'alpha closed item',
        status: 'done',
        priority: 'high',
        source: 'manual',
      }),
      seedDb.createIssue({
        projectId: secondaryProjectId,
        title: 'Alpha other project',
        description: 'alpha on other project',
        status: 'open',
        priority: 'high',
        source: 'manual',
      }),
    ];

    for (const result of seeded) {
      assert.equal(result.success, true);
    }
  }

  seedDb.close();

  const port = await allocatePort();
  const server = new KaryaApiServer({ host: '127.0.0.1', port });
  await server.initialize(config);

  if (options?.failingBoardSync) {
    const apiServer = server as unknown as {
      boardGenerator: {
        regenerate: () => Promise<{
          success: boolean;
          filePath: string;
          projectCount: number;
          issueCount: number;
          error?: Error;
        }>;
        dispose: () => Promise<void>;
      };
    };

    apiServer.boardGenerator = {
      regenerate: async () => ({
        success: false,
        filePath: config.boardOutput,
        projectCount: 0,
        issueCount: 0,
        error: new Error('Simulated board sync failure'),
      }),
      dispose: async () => undefined,
    };
  }

  await server.start();

  return {
    tempRoot,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    config,
    primaryProjectId,
    secondaryProjectId,
  };
}

/**
 * Stops server resources and removes the fixture directory.
 * @param fixture - Fixture to dispose
 * @internal
 */
async function cleanupFixture(fixture: TestFixture): Promise<void> {
  await fixture.server.stop();
  await rm(fixture.tempRoot, { recursive: true, force: true });
}

/**
 * Sends a JSON request and parses the JSON response payload.
 * @param baseUrl - Base server URL
 * @param method - HTTP method
 * @param requestPath - Route path
 * @param body - Optional JSON body
 * @returns HTTP status and parsed payload
 * @internal
 */
async function requestJson<T>(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  requestPath: string,
  body?: unknown
): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json()) as T;
  return {
    status: response.status,
    payload,
  };
}

/**
 * Allocates an ephemeral local port.
 * I close the probe socket immediately so the API server can bind to the returned port.
 * @returns Available port number
 * @internal
 */
async function allocatePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      probe.off('error', reject);
      resolve();
    });
  });

  const address = probe.address();
  if (!address || typeof address === 'string') {
    probe.close();
    throw new Error('Failed to allocate an ephemeral port');
  }

  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return port;
}
