#!/usr/bin/env node
/**
 * Local dev launcher for Spanda + Karya.
 * I pick free UI/API ports, start both processes with matching env, and tear them down together.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';

const DEFAULT_API_PORT = 9630;
const DEFAULT_UI_PORT = 9631;

/**
 * Entrypoint for the dev launcher.
 */
async function main() {
  const apiPort = await findAvailablePort(readRequestedPort('KARYA_API_PORT', DEFAULT_API_PORT));
  const uiPort = await findAvailablePort(
    readRequestedPort('VITE_DEV_PORT', DEFAULT_UI_PORT),
    new Set([apiPort])
  );

  if (apiPort !== DEFAULT_API_PORT) {
    console.log(`[dev-app] API port ${DEFAULT_API_PORT} is busy. Using ${apiPort} instead.`);
  }
  if (uiPort !== DEFAULT_UI_PORT) {
    console.log(`[dev-app] UI port ${DEFAULT_UI_PORT} is busy. Using ${uiPort} instead.`);
  }

  const sharedEnv = {
    ...process.env,
    KARYA_API_PORT: String(apiPort),
    KARYA_UI_PORT: String(uiPort),
    VITE_DEV_PORT: String(uiPort),
    VITE_KARYA_API_PORT: String(apiPort),
  };

  // I launch the API and UI independently so either one can log clearly.
  const apiProcess = spawn('pnpm', ['api:start'], {
    cwd: process.cwd(),
    env: sharedEnv,
    stdio: 'inherit',
  });
  const uiProcess = spawn('pnpm', ['ui:dev'], {
    cwd: process.cwd(),
    env: sharedEnv,
    stdio: 'inherit',
  });

  const cleanup = () => {
    apiProcess.kill('SIGTERM');
    uiProcess.kill('SIGTERM');
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  const exitCode = await new Promise((resolve) => {
    let settled = false;
    const settle = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(code ?? 0);
    };

    apiProcess.once('exit', (code) => settle(code));
    uiProcess.once('exit', (code) => settle(code));
  });

  process.exitCode = exitCode;
}

/**
 * Reads an optional numeric port from the environment.
 *
 * @param key - Environment variable name
 * @param fallback - Default port when env is missing or invalid
 * @returns Valid starting port
 */
function readRequestedPort(key, fallback) {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Finds the first available TCP port starting at a requested value.
 *
 * @param startPort - Port to probe first
 * @returns First free local port
 */
async function findAvailablePort(startPort, reservedPorts = new Set()) {
  let candidate = startPort;

  while (reservedPorts.has(candidate) || !(await isPortFree(candidate))) {
    candidate += 1;
  }

  return candidate;
}

/**
 * Checks whether a local port can be bound.
 *
 * @param port - Port to probe
 * @returns True when the port is free
 */
async function isPortFree(port) {
  const probe = createServer();

  try {
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    await new Promise((resolve) => {
      probe.close(() => resolve());
    });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev-app] Failed to start local stack: ${message}`);
  process.exitCode = 1;
});
