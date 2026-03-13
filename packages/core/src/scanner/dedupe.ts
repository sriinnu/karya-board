/**
 * Deduplication module for preventing duplicate processing of files.
 * Tracks in-flight scans and uses content hashing to prevent duplicates.
 * @packageDocumentation
 */

import crypto from 'crypto';

/**
 * Result type for deduplication check.
 * @public
 */
export interface DedupeCheck {
  /** Whether this is a new scan (not already in progress) */
  isNew: boolean;
  /** The content hash if available */
  contentHash?: string;
}

/**
 * Content hash store with in-flight tracking.
 * Prevents processing the same file multiple times concurrently.
 * @public
 */
export class ScanDeduplicator {
  /** Maps file paths to their content hashes */
  private hashStore = new Map<string, string>();

  /** Tracks files currently being processed */
  private inFlight = new Set<string>();

  /** Maximum number of hashes to store per project */
  private maxStoreSize: number;

  /**
   * Creates a new ScanDeduplicator instance.
   * @param maxStoreSize - Maximum number of hashes to keep in memory
   */
  constructor(maxStoreSize: number = 10000) {
    this.maxStoreSize = maxStoreSize;
  }

  /**
   * Generates a content hash for deduplication.
   * Uses SHA-256 for consistent hashing.
   *
   * @param content - File content to hash
   * @returns Hex string of the hash
   * @example
   * ```typescript
   * const hash = hasher.hashContent(fileContent);
   * ```
   */
  hashContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Checks if a file should be processed.
   * Marks the file as in-flight if it's new.
   *
   * @param filePath - Path to check
   * @param contentHash - Optional content hash for comparison
   * @returns DedupeCheck indicating whether to proceed
   * @example
   * ```typescript
   * const check = deduper.shouldProcess('/path/to/file.md', 'abc123');
   * if (check.isNew) {
   *   // Process the file
   * }
   * ```
   */
  shouldProcess(filePath: string, contentHash?: string): DedupeCheck {
    // Check if already in flight (another scan in progress)
    if (this.inFlight.has(filePath)) {
      return { isNew: false };
    }

    // If no content hash provided, treat as new
    if (!contentHash) {
      this.inFlight.add(filePath);
      return { isNew: true };
    }

    // Check if content has changed since last scan
    const storedHash = this.hashStore.get(filePath);
    if (storedHash && storedHash === contentHash) {
      // Content unchanged, no need to reprocess
      return { isNew: false, contentHash };
    }

    // New or changed content - mark as in flight
    this.inFlight.add(filePath);

    // Clean up store if it gets too large
    if (this.hashStore.size >= this.maxStoreSize) {
      this.cleanup();
    }

    return { isNew: true, contentHash };
  }

  /**
   * Marks a file scan as complete and updates the hash store.
   * Should be called after processing finishes.
   *
   * @param filePath - Path that was processed
   * @param contentHash - Hash of the processed content
   * @example
   * ```typescript
   * try {
   *   // Process file...
   *   deduper.complete('/path/to/file.md', hash);
   * } finally {
   *   // Ensure completion even on error
   * }
   * ```
   */
  complete(filePath: string, contentHash: string): void {
    this.inFlight.delete(filePath);
    this.hashStore.set(filePath, contentHash);
  }

  /**
   * Marks a file scan as failed/ancelled.
   * Removes from in-flight tracking but doesn't update hash.
   *
   * @param filePath - Path that failed
   * @example
   * ```typescript
   * try {
   *   // Process file...
   * } catch (e) {
   *   deduper.cancel('/path/to/file.md');
   *   throw e;
   * }
   * ```
   */
  cancel(filePath: string): void {
    this.inFlight.delete(filePath);
  }

  /**
   * Checks if a file is currently being processed.
   *
   * @param filePath - Path to check
   * @returns True if the file is in-flight
   */
  isInFlight(filePath: string): boolean {
    return this.inFlight.has(filePath);
  }

  /**
   * Removes a file from tracking entirely.
   * Used when a file is deleted.
   *
   * @param filePath - Path to remove
   */
  remove(filePath: string): void {
    this.inFlight.delete(filePath);
    this.hashStore.delete(filePath);
  }

  /**
   * Clears all tracking data.
   * Use with caution - this resets all state.
   */
  clear(): void {
    this.inFlight.clear();
    this.hashStore.clear();
  }

  /**
   * Gets the stored hash for a file if available.
   *
   * @param filePath - Path to check
   * @returns The stored hash or undefined
   */
  getStoredHash(filePath: string): string | undefined {
    return this.hashStore.get(filePath);
  }

  /**
   * Gets the number of tracked files.
   */
  get size(): number {
    return this.hashStore.size;
  }

  /**
   * Gets the number of files currently in flight.
   */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Cleans up the hash store by removing oldest entries.
   * Called when store reaches max size.
   * @internal
   */
  private cleanup(): void {
    // Remove oldest 20% of entries
    const entriesToRemove = Math.floor(this.maxStoreSize * 0.2);
    const keys = Array.from(this.hashStore.keys());
    for (let i = 0; i < entriesToRemove; i++) {
      this.hashStore.delete(keys[i]);
    }
  }
}

/**
 * Global deduplicator instance shared across the application.
 * @public
 */
export const globalDeduplicator = new ScanDeduplicator();
