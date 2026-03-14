/**
 * Integration tests for embedded scanner control routes.
 * I verify that the web UI can start the scanner through the HTTP API and immediately populate projects.
 * @packageDocumentation
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { type KaryaConfig } from '@karya/core';
import { KaryaApiServer } from './http.js';

interface TestFixture {
  /** Temp root directory for this test */
  tempRoot: string;
  /** Active API server */
  server: KaryaApiServer;
  /** Base URL for HTTP requests */
  baseUrl: string;
}

interface ScannerStatusPayload {
  /** Whether the request succeeded */
  success: boolean;
  /** Current scanner status */
  status?: {
    running: boolean;
    projectCount: number;
    lastStartedAt: number | null;
    mode: 'embedded';
  };
  /** Optional error message */
  error?: string;
}

interface ProjectsPayload {
  /** Whether the request succeeded */
  success: boolean;
  /** Returned projects */
  projects?: Array<{
    id: string;
    name: string;
    path: string;
  }>;
}

/**
 * Verifies that the embedded scanner can be started from the HTTP API.
 */
test('I start the embedded scanner through the API and populate projects for the web UI', async () => {
  const fixture = await createFixture();

  try {
    const initialStatus = await requestJson<ScannerStatusPayload>(
      fixture.baseUrl,
      'GET',
      '/api/scanner/status'
    );
    assert.equal(initialStatus.status, 200);
    assert.equal(initialStatus.payload.success, true);
    assert.equal(initialStatus.payload.status?.running, false);
    assert.equal(initialStatus.payload.status?.projectCount, 1);

    const started = await requestJson<ScannerStatusPayload>(
      fixture.baseUrl,
      'POST',
      '/api/scanner/start'
    );
    assert.equal(started.status, 200);
    assert.equal(started.payload.success, true);
    assert.equal(started.payload.status?.running, true);
    assert.equal(typeof started.payload.status?.lastStartedAt, 'number');

    const projects = await requestJson<ProjectsPayload>(
      fixture.baseUrl,
      'GET',
      '/api/projects'
    );
    assert.equal(projects.status, 200);
    assert.equal(projects.payload.success, true);
    assert.equal(projects.payload.projects?.length, 1);
    assert.equal(projects.payload.projects?.[0]?.name, 'Project One');
  } finally {
    await cleanupFixture(fixture);
  }
});

/**
 * Creates an isolated API fixture with one configured project.
 * @returns Initialized server fixture
 * @internal
 */
async function createFixture(): Promise<TestFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'karya-scanner-control-test-'));
  const dataDir = path.join(tempRoot, 'data');
  const projectPath = path.join(tempRoot, 'project-one');
  await mkdir(dataDir, { recursive: true });
  await mkdir(projectPath, { recursive: true });
  await writeFile(path.join(projectPath, 'README.md'), '# Project One\n', 'utf-8');

  const config: KaryaConfig = {
    boardOutput: path.join(tempRoot, 'BOARD.md'),
    scanDepth: 3,
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
        include: ['README.md'],
        exclude: ['node_modules'],
      },
    ],
  };

  const port = await allocatePort();
  const server = new KaryaApiServer({
    host: '127.0.0.1',
    port,
  });
  await server.initialize(config);
  await server.start();

  return {
    tempRoot,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

/**
 * Stops the server and removes the temp fixture directory.
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
 * @returns HTTP status and parsed payload
 * @internal
 */
async function requestJson<T>(
  baseUrl: string,
  method: 'GET' | 'POST',
  requestPath: string
): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${requestPath}`, { method });
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
