/**
 * EventBus implementation for Karya.
 * Provides pub/sub with pattern matching, wildcards, history replay, and async handler support.
 * @packageDocumentation
 */

import { createLogger } from '../logger.js';
import type {
  KaryaEvent,
  EventHandler,
  SubscriptionOptions,
  EventSubscription,
  EventBusOptions,
} from './types.js';

/**
 * Internal subscription representation.
 * @internal
 */
interface Subscription {
  id: string;
  pattern: string;
  handler: EventHandler;
  options: SubscriptionOptions;
  active: boolean;
  regex: RegExp;
}

/**
 * Scoped event bus logger.
 * @internal
 */
const logger = createLogger('events');

/**
 * Converts an event pattern to a RegExp for matching.
 * Supports wildcards:
 * - `*` matches any single segment (e.g., `db:*:created`)
 * - `**` matches multiple segments (e.g., `db:**`)
 *
 * @param pattern - Event pattern with wildcards
 * @returns RegExp for pattern matching
 * @internal
 */
function patternToRegex(pattern: string): RegExp {
  // Escape special regex characters except our wildcards
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<DOUBLE_WILDCARD>>')
    .replace(/\*/g, '[^:]+')
    .replace(/<<DOUBLE_WILDCARD>>/g, '.*');

  return new RegExp(`^${regex}$`);
}

/**
 * Generates a unique subscription ID.
 * @returns Unique string identifier
 * @internal
 */
function generateSubscriptionId(): string {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Generates a unique correlation ID for tracing related events.
 * @returns Unique string identifier
 * @public
 */
export function generateCorrelationId(): string {
  return `corr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * EventBus providing pub/sub with pattern matching and history.
 *
 * Features:
 * - Pattern matching with wildcards (`*` and `**`)
 * - Event history for replay
 * - Async handler support with timeout
 * - Subscription management
 *
 * @example
 * ```typescript
 * const bus = createEventBus({ maxHistorySize: 100 });
 *
 * // Subscribe to all database events
 * bus.subscribe('db:*', (event) => {
 *   console.log('DB event:', event.type);
 * });
 *
 * // Subscribe to all events
 * bus.subscribe('**', (event) => {
 *   console.log('Any event:', event.type);
 * });
 *
 * // Publish an event
 * bus.publish({ type: 'db:issue:created', ... });
 * ```
 *
 * @public
 */
export class EventBus {
  /** Map of subscription ID to subscription */
  private subscriptions = new Map<string, Subscription>();

  /** Event history for replay */
  private history: KaryaEvent[] = [];

  /** Configuration options */
  private options: Required<EventBusOptions>;

  /** Counter for generating unique subscription IDs */
  private subscriptionCounter = 0;

  /**
   * Creates a new EventBus instance.
   *
   * @param options - Configuration options
   */
  constructor(options: EventBusOptions = {}) {
    this.options = {
      maxHistorySize: options.maxHistorySize ?? 100,
      defaultHandlerTimeout: options.defaultHandlerTimeout ?? 30000,
      catchHandlerErrors: options.catchHandlerErrors ?? true,
    };
  }

  /**
   * Subscribes to events matching a pattern.
   *
   * Pattern syntax:
   * - `db:issue:created` - Exact match
   * - `db:*:created` - Match any single segment
   * - `db:**` - Match any number of segments
   * - `*` - Match any single-segment event
   * - `**` - Match all events
   *
   * @param pattern - Event pattern to match
   * @param handler - Function to call when event matches
   * @param options - Subscription options
   * @returns Subscription object for management
   * @example
   * ```typescript
   * const sub = bus.subscribe('db:issue:*', async (event) => {
   *   console.log('Issue event:', event);
   * });
   *
   * // Later, unsubscribe
   * sub.unsubscribe();
   * ```
   */
  subscribe(
    pattern: string,
    handler: EventHandler,
    options: SubscriptionOptions = {}
  ): EventSubscription {
    const id = options.id ?? generateSubscriptionId();
    const regex = patternToRegex(pattern);

    const subscription: Subscription = {
      id,
      pattern,
      handler,
      options,
      active: true,
      regex,
    };

    this.subscriptions.set(id, subscription);
    this.subscriptionCounter++;

    // Replay history if requested
    if (options.replay && this.history.length > 0) {
      const replayLimit = options.replayLimit ?? this.history.length;
      const eventsToReplay = this.history.slice(-replayLimit);

      for (const event of eventsToReplay) {
        if (regex.test(event.type)) {
          this.invokeHandler(subscription, event);
        }
      }
    }

    return {
      id,
      pattern,
      active: true,
      unsubscribe: () => {
        subscription.active = false;
        this.subscriptions.delete(id);
      },
    };
  }

  /**
   * Subscribes to a single event, then automatically unsubscribes.
   *
   * @param pattern - Event pattern to match
   * @param handler - Function to call when event matches
   * @param options - Subscription options
   * @returns Subscription object for management
   */
  once(
    pattern: string,
    handler: EventHandler,
    options: SubscriptionOptions = {}
  ): EventSubscription {
    const subscription = this.subscribe(
      pattern,
      async (event) => {
        subscription.unsubscribe();
        await handler(event);
      },
      options
    );

    return subscription;
  }

  /**
   * Publishes an event to all matching subscribers.
   *
   * @param event - Event to publish (without timestamp)
   * @returns Promise that resolves when all handlers have been invoked
   * @example
   * ```typescript
   * await bus.publish({
   *   type: 'db:issue:created',
   *   issue: { id: '123', ... }
   * });
   * ```
   */
  async publish(event: Omit<KaryaEvent, 'timestamp'>): Promise<void> {
    const fullEvent: KaryaEvent = {
      ...event,
      timestamp: Date.now(),
    } as KaryaEvent;

    // Add to history
    this.addToHistory(fullEvent);

    // Find and invoke matching handlers
    const promises: Promise<void>[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (subscription.active && subscription.regex.test(event.type)) {
        promises.push(this.invokeHandler(subscription, fullEvent));
      }
    }

    await Promise.all(promises);
  }

  /**
   * Publishes an event and waits for at least one subscriber to handle it.
   *
   * @param event - Event to publish
   * @returns True if at least one handler was invoked
   */
  async publishWithAck(event: Omit<KaryaEvent, 'timestamp'>): Promise<boolean> {
    const fullEvent: KaryaEvent = {
      ...event,
      timestamp: Date.now(),
    } as KaryaEvent;

    this.addToHistory(fullEvent);

    let handled = false;
    const promises: Promise<void>[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (subscription.active && subscription.regex.test(event.type)) {
        handled = true;
        promises.push(this.invokeHandler(subscription, fullEvent));
      }
    }

    await Promise.all(promises);
    return handled;
  }

  /**
   * Gets recent events from history.
   *
   * @param limit - Maximum number of events to return
   * @returns Array of recent events
   */
  getHistory(limit?: number): KaryaEvent[] {
    if (limit !== undefined) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /**
   * Gets events from history matching a pattern.
   *
   * @param pattern - Event pattern to match
   * @param limit - Maximum number of events to return
   * @returns Array of matching events
   */
  getHistoryByPattern(pattern: string, limit?: number): KaryaEvent[] {
    const regex = patternToRegex(pattern);
    const matching = this.history.filter((event) => regex.test(event.type));
    return limit !== undefined ? matching.slice(-limit) : matching;
  }

  /**
   * Clears the event history.
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Gets the number of active subscriptions.
   */
  get subscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Gets all active subscription patterns.
   */
  get activePatterns(): string[] {
    return Array.from(this.subscriptions.values())
      .filter((s) => s.active)
      .map((s) => s.pattern);
  }

  /**
   * Unsubscribes all subscriptions matching a pattern.
   *
   * @param pattern - Pattern to match subscriptions to remove
   * @returns Number of subscriptions removed
   */
  unsubscribePattern(pattern: string): number {
    let count = 0;
    for (const [id, subscription] of this.subscriptions) {
      if (subscription.pattern === pattern) {
        subscription.active = false;
        this.subscriptions.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Removes all subscriptions.
   */
  clear(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.active = false;
    }
    this.subscriptions.clear();
  }

  /**
   * Invokes a handler with timeout and error handling.
   * @internal
   */
  private async invokeHandler(
    subscription: Subscription,
    event: KaryaEvent
  ): Promise<void> {
    const timeout = subscription.options.timeout ?? this.options.defaultHandlerTimeout;

    try {
      const result = subscription.handler(event as Parameters<typeof subscription.handler>[0]);

      if (result instanceof Promise) {
        await this.withTimeout(result, timeout);
      }
    } catch (error) {
      if (this.options.catchHandlerErrors) {
        logger.error(
          `Error in event handler for ${event.type} (subscription: ${subscription.id}):`,
          error
        );
      } else {
        throw error;
      }
    }
  }

  /**
   * Wraps a promise with a timeout.
   * @internal
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    if (timeoutMs <= 0) {
      return promise;
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Handler timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Adds an event to the history, respecting the size limit.
   * @internal
   */
  private addToHistory(event: KaryaEvent): void {
    this.history.push(event);

    // Trim history if it exceeds the limit
    if (this.history.length > this.options.maxHistorySize) {
      this.history = this.history.slice(-this.options.maxHistorySize);
    }
  }
}

/**
 * Creates a new EventBus instance.
 *
 * @param options - Configuration options
 * @returns Configured EventBus instance
 * @example
 * ```typescript
 * const eventBus = createEventBus({ maxHistorySize: 200 });
 * ```
 * @public
 */
export function createEventBus(options?: EventBusOptions): EventBus {
  return new EventBus(options);
}
