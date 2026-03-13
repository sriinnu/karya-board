/**
 * Database locking and write queue implementation.
 * Provides serialized writes with retry logic to handle SQLite busy/locked errors.
 * @packageDocumentation
 */

import type PQueue from 'p-queue';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Default maximum number of retry attempts for failed operations.
 * @internal
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Default initial delay in milliseconds before first retry.
 * @internal
 */
const DEFAULT_INITIAL_DELAY_MS = 50;

/**
 * Error codes that indicate a retryable SQLite error.
 * @internal
 */
const RETRYABLE_ERRORS = new Set([
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'SQLITE_PROTOCOL',
]);

/**
 * Checks if the given error is a retryable SQLite error.
 * @param error - The error to check
 * @returns True if the error is retryable
 * @internal
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    if (code && RETRYABLE_ERRORS.has(code)) {
      return true;
    }
    // Also check message for common SQLite busy patterns
    const message = error.message.toLowerCase();
    return (
      message.includes('database is locked') ||
      message.includes('database busy') ||
      message.includes('sqlbusy')
    );
  }
  return false;
}

/**
 * Sleep utility for implementing delays.
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 * @internal
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry configuration options.
 * @public
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial delay in milliseconds (doubles each retry) */
  initialDelayMs?: number;
  /** Function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Result type for operations that can fail.
 * @public
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Executes a function with exponential backoff retry logic.
 * This is the core mechanism for handling SQLite busy/locked errors.
 *
 * @param operation - The async function to execute
 * @param options - Retry configuration options
 * @returns Result containing the operation result or error
 * @example
 * ```typescript
 * const result = await withRetry(async () => {
 *   return db.prepare('INSERT INTO issues VALUES (?, ?)').run(id, title);
 * }, { maxRetries: 3, initialDelayMs: 50 });
 * ```
 * @public
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<Result<T>> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const isRetryable = options.isRetryable ?? isRetryableError;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const data = await operation();
      return { success: true, data };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if we've exhausted attempts or error isn't retryable
      if (attempt >= maxRetries || !isRetryable(error)) {
        return { success: false, error: lastError };
      }

      // Exponential backoff: 50, 100, 200, 400...
      const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
      await sleep(delayMs);
    }
  }

  // This should never be reached but satisfies TypeScript
  return {
    success: false,
    error: lastError ?? new Error('Unknown error during retry'),
  };
}

/**
 * Creates a serial write queue that ensures database writes happen sequentially.
 * This prevents SQLite lock conflicts when multiple operations try to write simultaneously.
 *
 * @param queue - The p-queue instance to use
 * @returns A function that executes operations serially
 * @example
 * ```typescript
 * const writeQueue = createWriteQueue();
 *
 * await writeQueue(async () => {
 *   db.prepare('INSERT INTO issues VALUES (?, ?)').run(id, title);
 * });
 * ```
 * @public
 */
export function createWriteQueue(
  queue: PQueue
): <T>(operation: () => Promise<T>) => Promise<T> {
  /**
   * Executes an operation through the serial queue with retry logic.
   * All writes are serialized to prevent SQLite lock conflicts.
   */
  return async function write<T>(operation: () => Promise<T>): Promise<T> {
    return queue.add(async () => {
      // Use immediate retry for queue operations since serialization
      // should handle most conflicts; still wrap for safety
      const result = await withRetry(operation, {
        maxRetries: 2,
        initialDelayMs: 25,
      });

      if (!result.success) {
        throw result.error;
      }

      return result.data;
    }) as Promise<T>;
  };
}

/**
 * Acquires an exclusive write lock on the database using BEGIN IMMEDIATE.
 * This is used for critical write operations that need immediate exclusive access.
 *
 * @param db - The SQLite database connection
 * @returns A function to release the lock (call after operation completes)
 * @example
 * ```typescript
 * const releaseLock = await acquireWriteLock(db);
 * try {
 *   db.prepare('UPDATE issues SET status = ? WHERE id = ?').run('done', id);
 * } finally {
 *   releaseLock();
 * }
 * ```
 * @public
 */
export async function acquireWriteLock(
  db: BetterSqlite3.Database
): Promise<(rollback?: boolean) => void> {
  // BEGIN IMMEDIATE acquires a write lock right away
  // rather than waiting until the first write
  db.prepare('BEGIN IMMEDIATE').run();
  let released = false;

  return (rollback = false) => {
    // Release is idempotent so callers can safely call it in finally blocks.
    if (released) {
      return;
    }
    released = true;

    if (rollback) {
      try {
        db.prepare('ROLLBACK').run();
      } catch {
        // Ignore rollback errors
      }
      return;
    }

    try {
      db.prepare('COMMIT').run();
    } catch {
      // If commit fails, try rollback to close the transaction.
      try {
        db.prepare('ROLLBACK').run();
      } catch {
        // Ignore rollback errors
      }
    }
  };
}

/**
 * Executes a function with an exclusive database write lock.
 * Ensures no other write operations can occur simultaneously.
 *
 * @param db - The SQLite database connection
 * @param operation - The operation to execute with the lock
 * @returns The result of the operation
 * @example
 * ```typescript
 * const result = await withWriteLock(db, async () => {
 *   return db.prepare('DELETE FROM issues WHERE id = ?').run(id);
 * });
 * ```
 * @public
 */
export async function withWriteLock<T>(
  db: BetterSqlite3.Database,
  operation: () => Promise<T>
): Promise<T> {
  const release = await acquireWriteLock(db);
  try {
    const result = await operation();
    release(false);
    return result;
  } catch (error) {
    release(true);
    throw error;
  } finally {
    // Safety call; no-op if already released above.
    release();
  }
}

export { sleep, isRetryableError };
