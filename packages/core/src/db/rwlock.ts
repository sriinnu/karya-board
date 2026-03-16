/**
 * Read/Write Lock implementation for concurrent SQLite access.
 * Allows multiple concurrent readers but exclusive writer access.
 * @packageDocumentation
 */

/**
 * Lock holder information for debugging.
 * @internal
 */
interface LockHolder {
  /** Unique identifier for the lock holder */
  id: string;
  /** Type of lock held */
  type: 'read' | 'write';
  /** Timestamp when the lock was acquired */
  acquiredAt: number;
  /** Optional description of what the lock is for */
  description?: string;
  /** Stack trace at acquisition time (if debug mode) */
  stack?: string;
}

/**
 * RwLock configuration options.
 * @public
 */
export interface RwLockOptions {
  /** Timeout for acquiring a lock in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to capture stack traces for debugging (default: false) */
  captureStack?: boolean;
  /** Maximum number of concurrent readers (default: Infinity) */
  maxReaders?: number;
  /** Writer priority - if true, writers get priority over waiting readers (default: true) */
  writerPriority?: boolean;
}

/**
 * Result of a lock acquisition attempt.
 * @public
 */
export type RwLockResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error; timedOut: boolean };

/**
 * Generates a unique lock holder ID.
 * @internal
 */
function generateLockHolderId(): string {
  return `lock_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Read/Write Lock for managing concurrent access to shared resources.
 *
 * Features:
 * - Multiple concurrent readers
 * - Exclusive writer access
 * - Writer priority to prevent starvation
 * - Configurable timeout
 * - Lock holder tracking for debugging
 *
 * @example
 * ```typescript
 * const rwlock = createRwLock({ timeout: 5000 });
 *
 * // Read operation (multiple can run concurrently)
 * const data = await rwlock.read(async () => {
 *   return db.getData();
 * });
 *
 * // Write operation (exclusive access)
 * await rwlock.write(async () => {
 *   db.setData(newData);
 * });
 * ```
 *
 * @public
 */
export class RwLock {
  /** Number of active readers */
  private readerCount = 0;

  /** Whether a writer is active */
  private writerActive = false;

  /** Queue of waiting readers */
  private waitingReaders: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    holder: LockHolder;
    timeout: ReturnType<typeof setTimeout> | null;
  }> = [];

  /** Queue of waiting writers */
  private waitingWriters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    holder: LockHolder;
    timeout: ReturnType<typeof setTimeout> | null;
  }> = [];

  /** Active lock holders for debugging */
  private lockHolders = new Map<string, LockHolder>();

  /** Configuration options */
  private options: Required<RwLockOptions>;

  /**
   * Creates a new RwLock instance.
   *
   * @param options - Configuration options
   */
  constructor(options: RwLockOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 30000,
      captureStack: options.captureStack ?? false,
      maxReaders: options.maxReaders ?? Infinity,
      writerPriority: options.writerPriority ?? true,
    };
  }

  /**
   * Acquires a read lock and executes the operation.
   * Multiple read locks can be held simultaneously.
   *
   * @param operation - The operation to execute with the read lock
   * @param description - Optional description for debugging
   * @returns The result of the operation
   */
  async read<T>(operation: () => Promise<T>, description?: string): Promise<T> {
    const holderId = await this.acquireRead(description);

    try {
      return await operation();
    } finally {
      this.releaseRead(holderId);
    }
  }

  /**
   * Acquires a write lock and executes the operation.
   * Write locks are exclusive - no other readers or writers can access.
   *
   * @param operation - The operation to execute with the write lock
   * @param description - Optional description for debugging
   * @returns The result of the operation
   */
  async write<T>(operation: () => Promise<T>, description?: string): Promise<T> {
    const holderId = await this.acquireWrite(description);

    try {
      return await operation();
    } finally {
      this.releaseWrite(holderId);
    }
  }

  /**
   * Attempts to acquire a read lock with a timeout.
   *
   * @param operation - The operation to execute with the read lock
   * @param timeoutMs - Timeout in milliseconds
   * @param description - Optional description for debugging
   * @returns Result containing the operation result or timeout error
   */
  async tryRead<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    description?: string
  ): Promise<RwLockResult<T>> {
    try {
      const holderId = await this.acquireRead(description, timeoutMs);
      try {
        const data = await operation();
        return { success: true, data };
      } finally {
        this.releaseRead(holderId);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const timedOut = err.message.includes('timeout');
      return { success: false, error: err, timedOut };
    }
  }

  /**
   * Attempts to acquire a write lock with a timeout.
   *
   * @param operation - The operation to execute with the write lock
   * @param timeoutMs - Timeout in milliseconds
   * @param description - Optional description for debugging
   * @returns Result containing the operation result or timeout error
   */
  async tryWrite<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    description?: string
  ): Promise<RwLockResult<T>> {
    try {
      const holderId = await this.acquireWrite(description, timeoutMs);
      try {
        const data = await operation();
        return { success: true, data };
      } finally {
        this.releaseWrite(holderId);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const timedOut = err.message.includes('timeout');
      return { success: false, error: err, timedOut };
    }
  }

  /**
   * Gets the current lock state for debugging.
   */
  get state(): {
    readerCount: number;
    writerActive: boolean;
    waitingReaders: number;
    waitingWriters: number;
    lockHolders: LockHolder[];
  } {
    return {
      readerCount: this.readerCount,
      writerActive: this.writerActive,
      waitingReaders: this.waitingReaders.length,
      waitingWriters: this.waitingWriters.length,
      lockHolders: Array.from(this.lockHolders.values()),
    };
  }

  /**
   * Checks if any lock is currently held.
   */
  get isLocked(): boolean {
    return this.readerCount > 0 || this.writerActive;
  }

  /**
   * Acquires a read lock.
   * @internal
   */
  private async acquireRead(description?: string, timeout?: number): Promise<string> {
    const holderId = generateLockHolderId();
    const holder: LockHolder = {
      id: holderId,
      type: 'read',
      acquiredAt: Date.now(),
      description,
      stack: this.options.captureStack ? new Error().stack : undefined,
    };

    // Can read if:
    // - No writer is active
    // - No writers are waiting (if writer priority) OR we're not at max readers
    const canRead =
      !this.writerActive &&
      (this.readerCount < this.options.maxReaders) &&
      (!this.options.writerPriority || this.waitingWriters.length === 0);

    if (canRead) {
      this.readerCount++;
      this.lockHolders.set(holderId, holder);
      return holderId;
    }

    // Need to wait
    return new Promise<string>((resolve, reject) => {
      const waitEntry = {
        resolve: () => {
          this.readerCount++;
          this.lockHolders.set(holderId, holder);
          resolve(holderId);
        },
        reject,
        holder,
        timeout: null as ReturnType<typeof setTimeout> | null,
      };

      const timeoutMs = timeout ?? this.options.timeout;
      if (timeoutMs > 0) {
        waitEntry.timeout = setTimeout(() => {
          const index = this.waitingReaders.indexOf(waitEntry);
          if (index !== -1) {
            this.waitingReaders.splice(index, 1);
            reject(new Error(`Read lock acquisition timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }

      this.waitingReaders.push(waitEntry);
    });
  }

  /**
   * Releases a read lock.
   * @internal
   */
  private releaseRead(holderId: string): void {
    this.readerCount--;
    this.lockHolders.delete(holderId);

    // If no more readers and writers are waiting, wake up a writer
    if (this.readerCount === 0 && this.waitingWriters.length > 0) {
      const next = this.waitingWriters.shift()!;
      if (next.timeout) {
        clearTimeout(next.timeout);
      }
      next.resolve();
    }
    // If writer priority is off and readers are waiting, wake them up
    else if (!this.options.writerPriority && this.waitingReaders.length > 0) {
      while (
        this.waitingReaders.length > 0 &&
        this.readerCount < this.options.maxReaders &&
        !this.writerActive
      ) {
        const next = this.waitingReaders.shift()!;
        if (next.timeout) {
          clearTimeout(next.timeout);
        }
        next.resolve();
      }
    }
  }

  /**
   * Acquires a write lock.
   * @internal
   */
  private async acquireWrite(description?: string, timeout?: number): Promise<string> {
    const holderId = generateLockHolderId();
    const holder: LockHolder = {
      id: holderId,
      type: 'write',
      acquiredAt: Date.now(),
      description,
      stack: this.options.captureStack ? new Error().stack : undefined,
    };

    // Can write if no readers and no writer active
    if (this.readerCount === 0 && !this.writerActive) {
      this.writerActive = true;
      this.lockHolders.set(holderId, holder);
      return holderId;
    }

    // Need to wait
    return new Promise<string>((resolve, reject) => {
      const waitEntry = {
        resolve: () => {
          this.writerActive = true;
          this.lockHolders.set(holderId, holder);
          resolve(holderId);
        },
        reject,
        holder,
        timeout: null as ReturnType<typeof setTimeout> | null,
      };

      const timeoutMs = timeout ?? this.options.timeout;
      if (timeoutMs > 0) {
        waitEntry.timeout = setTimeout(() => {
          const index = this.waitingWriters.indexOf(waitEntry);
          if (index !== -1) {
            this.waitingWriters.splice(index, 1);
            reject(new Error(`Write lock acquisition timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }

      this.waitingWriters.push(waitEntry);
    });
  }

  /**
   * Releases a write lock.
   * @internal
   */
  private releaseWrite(holderId: string): void {
    this.writerActive = false;
    this.lockHolders.delete(holderId);

    // If writer priority and more writers waiting, prefer next writer
    if (this.options.writerPriority && this.waitingWriters.length > 0) {
      const next = this.waitingWriters.shift()!;
      if (next.timeout) {
        clearTimeout(next.timeout);
      }
      next.resolve();
      return;
    }

    // Wake up all waiting readers (they can read concurrently)
    while (
      this.waitingReaders.length > 0 &&
      this.readerCount < this.options.maxReaders
    ) {
      const next = this.waitingReaders.shift()!;
      if (next.timeout) {
        clearTimeout(next.timeout);
      }
      next.resolve();
    }

    // If no readers but writers waiting, wake up a writer
    if (this.readerCount === 0 && this.waitingWriters.length > 0) {
      const next = this.waitingWriters.shift()!;
      if (next.timeout) {
        clearTimeout(next.timeout);
      }
      next.resolve();
    }
  }
}

/**
 * Creates a new RwLock instance.
 *
 * @param options - Configuration options
 * @returns Configured RwLock instance
 * @example
 * ```typescript
 * const rwlock = createRwLock({ timeout: 5000, writerPriority: true });
 *
 * // Multiple concurrent reads
 * const [a, b] = await Promise.all([
 *   rwlock.read(() => db.getData()),
 *   rwlock.read(() => db.getOtherData()),
 * ]);
 *
 * // Exclusive write
 * await rwlock.write(() => db.setData(newData));
 * ```
 * @public
 */
export function createRwLock(options?: RwLockOptions): RwLock {
  return new RwLock(options);
}
