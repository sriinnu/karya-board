#!/usr/bin/env node
/**
 * Local autonomous verification loop for Karya.
 * I watch the repository for source/config changes and rerun a verification command on each stable change burst.
 */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Root directory for this repository. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Paths I always ignore because they are generated, external, or noisy. */
const DEFAULT_IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.turbo',
  '.next',
  'coverage',
]);

/** File names I ignore because they are generated as part of verify runs. */
const DEFAULT_IGNORED_BASENAMES = new Set([
  'BOARD.md',
  'karya.db',
  'karya.db-shm',
  'karya.db-wal',
]);

/**
 * Entrypoint for the verify watch loop.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const verifyCommand = options.command || (options.quick ? 'pnpm typecheck && pnpm test' : 'pnpm verify');
  const state = {
    child: null,
    rerunRequested: false,
    timer: null,
    disposed: false,
  };

  const watcherHandles = [];
  const watchedDirectories = new Set();

  /**
   * I close all active watchers during shutdown so process exit stays clean.
   */
  const shutdown = () => {
    state.disposed = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    for (const entry of watcherHandles) {
      entry.close();
    }
    watcherHandles.length = 0;
    if (state.child && state.child.exitCode === null) {
      state.child.kill('SIGTERM');
    }
  };

  process.once('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  /**
   * I debounce bursts of filesystem events so one save operation triggers one verify run.
   */
  const scheduleRun = (reason) => {
    if (state.disposed) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = setTimeout(() => {
      state.timer = null;
      void runVerify(reason);
    }, options.debounceMs);
  };

  /**
   * I execute verify serially and queue exactly one follow-up run when more changes arrive mid-run.
   */
  const runVerify = async (reason) => {
    if (state.disposed) {
      return;
    }

    if (state.child && state.child.exitCode === null) {
      state.rerunRequested = true;
      return;
    }

    const startedAt = new Date();
    console.log(`\n[verify-watch] ${startedAt.toISOString()} | reason: ${reason}`);
    console.log(`[verify-watch] command: ${verifyCommand}`);

    state.child = spawn(verifyCommand, {
      cwd: options.root,
      shell: true,
      stdio: 'inherit',
      env: process.env,
    });

    await new Promise((resolve) => {
      state.child.once('exit', (code, signal) => {
        const endedAt = new Date();
        const status = signal ? `signal ${signal}` : `exit ${code ?? 1}`;
        console.log(`[verify-watch] ${endedAt.toISOString()} | completed: ${status}`);
        resolve();
      });
    });

    state.child = null;

    if (state.rerunRequested) {
      state.rerunRequested = false;
      void runVerify('queued changes during previous run');
    }
  };

  /**
   * I handle one filesystem event and optionally enroll new directories when recursive watch is unavailable.
   *
   * @param basePath - Watch root for the event callback
   * @param eventType - Native fs.watch event type
   * @param filename - Optional changed entry name
   * @param shouldEnrollChildren - Whether rename events should trigger child-directory enrollment
   */
  const handleWatchEvent = async (basePath, eventType, filename, shouldEnrollChildren) => {
    const filePath = filename ? path.join(basePath, String(filename)) : basePath;
    if (shouldIgnorePath(options.root, filePath)) {
      return;
    }

    scheduleRun(`${eventType} ${path.relative(options.root, filePath) || '.'}`);

    if (!shouldEnrollChildren || eventType !== 'rename') {
      return;
    }

    try {
      const childPath = path.resolve(filePath);
      await watchDirectory(childPath);
    } catch {
      // I keep this best-effort; missing paths are expected on delete/move events.
    }
  };

  /**
   * I attach a watcher for one directory if it is not already being watched.
   */
  const watchDirectory = async (directoryPath) => {
    const resolved = path.resolve(directoryPath);
    if (watchedDirectories.has(resolved) || shouldIgnorePath(options.root, resolved)) {
      return;
    }
    watchedDirectories.add(resolved);

    try {
      const handle = watch(resolved, { persistent: true }, (eventType, filename) => {
        void handleWatchEvent(resolved, eventType, filename, true);
      });

      handle.on('error', (error) => {
        console.warn(`[verify-watch] watcher error at ${resolved}: ${error.message}`);
      });

      watcherHandles.push(handle);
    } catch (error) {
      // I skip unreadable or unsupported paths and continue.
    }

    // I register existing child directories recursively for portability.
    try {
      const entries = await readdir(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const childDirectory = path.join(resolved, entry.name);
        if (shouldIgnorePath(options.root, childDirectory)) {
          continue;
        }
        await watchDirectory(childDirectory);
      }
    } catch {
      // I tolerate transient permission or existence errors.
    }
  };

  console.log(`[verify-watch] root: ${options.root}`);
  console.log(`[verify-watch] debounce: ${options.debounceMs}ms`);
  console.log(`[verify-watch] initial run: ${options.initial ? 'enabled' : 'disabled'}`);

  if (options.once) {
    await runVerify('single run');
    shutdown();
    return;
  }

  /**
   * I prefer one recursive watcher where the platform supports it because it avoids EMFILE on large trees.
   *
   * @returns True when recursive watching is active
   */
  const startRecursiveWatcher = () => {
    try {
      const resolvedRoot = path.resolve(options.root);
      const handle = watch(resolvedRoot, { persistent: true, recursive: true }, (eventType, filename) => {
        void handleWatchEvent(resolvedRoot, eventType, filename, false);
      });
      handle.on('error', (error) => {
        console.warn(`[verify-watch] watcher error at ${resolvedRoot}: ${error.message}`);
      });
      watcherHandles.push(handle);
      watchedDirectories.add(resolvedRoot);
      return true;
    } catch {
      return false;
    }
  };

  if (!startRecursiveWatcher()) {
    await watchDirectory(options.root);
  }

  if (options.initial) {
    await runVerify('initial');
  }

  console.log('[verify-watch] watching for changes. Press Ctrl+C to stop.');
}

/**
 * Parses CLI arguments into strongly typed options.
 *
 * @param argv - Raw argument vector
 * @returns Parsed options
 */
function parseArgs(argv) {
  const options = {
    root: REPO_ROOT,
    debounceMs: 1200,
    command: '',
    initial: true,
    quick: false,
    once: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--root' && argv[i + 1]) {
      options.root = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--debounce-ms' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 100) {
        options.debounceMs = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (token === '--command' && argv[i + 1]) {
      options.command = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--no-initial') {
      options.initial = false;
      continue;
    }
    if (token === '--quick') {
      options.quick = true;
      continue;
    }
    if (token === '--once') {
      options.once = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
  }

  return options;
}

/**
 * Determines whether a path should be ignored by the watch loop.
 *
 * @param root - Repository root
 * @param targetPath - Candidate file or directory path
 * @returns True when the path should be ignored
 */
function shouldIgnorePath(root, targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..')) {
    return false;
  }

  const basename = path.basename(resolved);
  if (DEFAULT_IGNORED_BASENAMES.has(basename) || basename.endsWith('.tsbuildinfo')) {
    return true;
  }

  const parts = relative.split(path.sep);
  return parts.some((segment) => DEFAULT_IGNORED_SEGMENTS.has(segment));
}

/**
 * Prints CLI usage information.
 */
function printHelp() {
  console.log(`
Usage:
  node scripts/verify-watch.mjs [options]

Options:
  --quick                run a faster subset (pnpm typecheck && pnpm test)
  --command "<cmd>"      override command (default: pnpm verify)
  --debounce-ms <n>      debounce window for file changes (default: 1200)
  --root <path>          watch root (default: repository root)
  --no-initial           do not run command immediately on startup
  --once                 run once and exit
  -h, --help             show this help
`);
}

await main();
