/**
 * Integration tests for project scan-settings HTTP routes.
 * I verify that include and exclude rules persist to karya.config.json and round-trip through the API.
 * @packageDocumentation
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Database, type KaryaConfig } from '@karya/core';
import { KaryaApiServer } from './http.js';

interface TestFixture {
  /** Temp root directory for the test run */
  tempRoot: string;
  /** Base URL for HTTP requests */
  baseUrl: string;
  /** Active API server */
  server: KaryaApiServer;
  /** Persisted config file path */
  configPath: string;
  /** Primary project identifier */
  primaryProjectId: string;
}

interface MutationPayload {
  /** Whether the request succeeded */
  success: boolean;
  /** Optional persisted settings payload */
  settings?: {
    include: string[];
    exclude: string[];
  };
  /** Optional warning */
  warning?: string;
  /** Optional error */
  error?: string;
}

interface ProjectsPayload {
  /** Whether the request succeeded */
  success: boolean;
  /** Returned projects */
  projects?: Array<{
    id: string;
    scanSettings: {
      include: string[];
      exclude: string[];
    };
  }>;
}

/**
 * Verifies that project scan settings persist through the HTTP API and config file.
 */
test('I persist project scan settings and surface them on subsequent project loads', async () => {
  const fixture = await createFixture();

  try {
    const updated = await requestJson<MutationPayload>(
      fixture.baseUrl,
      'PATCH',
      `/api/projects/${encodeURIComponent(fixture.primaryProjectId)}/scan-settings`,
      {
        include: ['src/**', 'docs/**', 'docs/**', '   '],
        exclude: ['node_modules', 'dist'],
      }
    );

    assert.equal(updated.status, 200);
    assert.equal(updated.payload.success, true);
    assert.deepEqual(updated.payload.settings, {
      include: ['src/**', 'docs/**'],
      exclude: ['node_modules', 'dist'],
    });
    assert.match(updated.payload.warning ?? '', /restart the scanner/i);

    const projects = await requestJson<ProjectsPayload>(fixture.baseUrl, 'GET', '/api/projects');
    assert.equal(projects.status, 200);
    assert.equal(projects.payload.success, true);
    assert.deepEqual(
      projects.payload.projects?.find((project) => project.id === fixture.primaryProjectId)
        ?.scanSettings,
      {
        include: ['src/**', 'docs/**'],
        exclude: ['node_modules', 'dist'],
      }
    );

    // I read the on-disk config to prove the route persisted the update instead of faking UI state.
    const persisted = JSON.parse(await readFile(fixture.configPath, 'utf-8')) as KaryaConfig;
    assert.deepEqual(persisted.projects[0]?.include, ['src/**', 'docs/**']);
    assert.deepEqual(persisted.projects[0]?.exclude, ['node_modules', 'dist']);
  } finally {
    await cleanupFixture(fixture);
  }
});

/**
 * Creates an isolated API fixture with a writable config file.
 * @returns Initialized server fixture
 * @internal
 */
async function createFixture(): Promise<TestFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'karya-scan-settings-test-'));
  const dataDir = path.join(tempRoot, 'data');
  const projectPath = path.join(tempRoot, 'project-one');
  const configPath = path.join(tempRoot, 'karya.config.json');
  await mkdir(dataDir, { recursive: true });
  await mkdir(projectPath, { recursive: true });

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
      {
        name: 'Project One',
        path: projectPath,
        include: ['src/**'],
        exclude: ['dist'],
      },
    ],
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');

  const db = new Database(config.database.path);
  const init = db.initialize();
  assert.equal(init.success, true);

  const created = db.createProject('Project One', projectPath);
  assert.equal(created.success, true);
  const primaryProjectId = created.data.id;
  db.close();

  const port = await allocatePort();
  const server = new KaryaApiServer({
    host: '127.0.0.1',
    port,
    configPath,
  });
  await server.initialize(config);
  await server.start();

  return {
    tempRoot,
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    configPath,
    primaryProjectId,
  };
}

/**
 * Stops the server and removes the temp directory.
 * @param fixture - Fixture to clean up
 * @internal
 */
async function cleanupFixture(fixture: TestFixture): Promise<void> {
  await fixture.server.stop();
  await rm(fixture.tempRoot, { recursive: true, force: true });
}

/**
 * Sends a JSON request and parses the JSON response.
 * @param baseUrl - Base server URL
 * @param method - HTTP method
 * @param requestPath - Route path
 * @param body - Optional JSON body
 * @returns HTTP status and parsed payload
 * @internal
 */
async function requestJson<T>(
  baseUrl: string,
  method: 'GET' | 'PATCH',
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
 * Allocates a free local TCP port for the test server.
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
