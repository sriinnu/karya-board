/**
 * MCP tool for subscribing to EventBus events.
 * Allows MCP clients to receive real-time notifications when events occur.
 * @packageDocumentation
 */

import type { EventBus, EventSubscription } from '@karya/core';

/**
 * Parameters for the subscribe_events tool.
 * @public
 */
export interface SubscribeEventsParams {
  /** Event pattern to subscribe to (e.g., 'db:*', 'scanner:file:*') */
  pattern: string;
  /** Optional subscription ID for later reference */
  subscriptionId?: string;
}

/**
 * Result of the subscribe_events tool.
 * @public
 */
export interface SubscribeEventsResult {
  /** Whether the subscription was successful */
  success: boolean;
  /** Subscription ID for later management */
  subscriptionId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of the unsubscribe_events tool.
 * @public
 */
export interface UnsubscribeEventsResult {
  /** Whether the unsubscription was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Parameters for the unsubscribe_events tool.
 * @public
 */
export interface UnsubscribeEventsParams {
  /** Subscription ID to unsubscribe */
  subscriptionId: string;
}

/**
 * Active subscription tracking.
 * @internal
 */
const activeSubscriptions = new Map<string, EventSubscription>();

/**
 * Callback for emitting events to MCP clients.
 * @internal
 */
let eventEmitter: ((event: unknown) => void) | null = null;

/**
 * Sets the event emitter function for notifying MCP clients.
 *
 * @param emitter - Function to call when events occur
 * @internal
 */
export function setEventEmitter(emitter: (event: unknown) => void): void {
  eventEmitter = emitter;
}

/**
 * Creates the subscribe_events MCP tool.
 *
 * @param eventBus - EventBus instance to subscribe to
 * @returns Tool handler function
 * @public
 */
export function createSubscribeEventsTool(eventBus: EventBus) {
  return async (params: SubscribeEventsParams): Promise<SubscribeEventsResult> => {
    try {
      if (!params.pattern || typeof params.pattern !== 'string') {
        return {
          success: false,
          error: 'Pattern is required and must be a string',
        };
      }

      const subscriptionId = params.subscriptionId ?? `sub_${Date.now().toString(36)}`;

      // Check if subscription ID already exists
      if (activeSubscriptions.has(subscriptionId)) {
        return {
          success: false,
          error: `Subscription ID already exists: ${subscriptionId}`,
        };
      }

      // Create subscription
      const subscription = eventBus.subscribe(
        params.pattern,
        (event) => {
          // Forward event to MCP client if emitter is set
          if (eventEmitter) {
            eventEmitter({
              subscriptionId,
              pattern: params.pattern,
              event,
            });
          }
        },
        { id: subscriptionId }
      );

      activeSubscriptions.set(subscriptionId, subscription);

      return {
        success: true,
        subscriptionId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Creates the unsubscribe_events MCP tool.
 *
 * @returns Tool handler function
 * @public
 */
export function createUnsubscribeEventsTool() {
  return async (params: UnsubscribeEventsParams): Promise<UnsubscribeEventsResult> => {
    try {
      const subscription = activeSubscriptions.get(params.subscriptionId);
      if (!subscription) {
        return {
          success: false,
          error: `Subscription not found: ${params.subscriptionId}`,
        };
      }

      subscription.unsubscribe();
      activeSubscriptions.delete(params.subscriptionId);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Creates the list_subscriptions MCP tool.
 *
 * @returns Tool handler function
 * @public
 */
export function createListSubscriptionsTool() {
  return async (): Promise<{
    success: boolean;
    subscriptions?: Array<{ id: string; pattern: string; active: boolean }>;
    error?: string;
  }> => {
    try {
      const subscriptions = Array.from(activeSubscriptions.entries()).map(([id, sub]) => ({
        id,
        pattern: sub.pattern,
        active: sub.active,
      }));

      return {
        success: true,
        subscriptions,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Gets the count of active subscriptions.
 * @internal
 */
export function getActiveSubscriptionCount(): number {
  return activeSubscriptions.size;
}

/**
 * Clears all active subscriptions.
 * @internal
 */
export function clearAllSubscriptions(): void {
  for (const subscription of activeSubscriptions.values()) {
    subscription.unsubscribe();
  }
  activeSubscriptions.clear();
}

/**
 * Input schema for the subscribe_events tool.
 * @public
 */
export const SUBSCRIBE_EVENTS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description:
        'Event pattern to subscribe to. Supports wildcards: ' +
        "'*' matches single segment (e.g., 'db:*:created'), '**' matches multiple segments (e.g., 'db:**')",
    },
    subscriptionId: {
      type: 'string',
      description: 'Optional unique ID for this subscription. If not provided, one will be generated.',
    },
  },
  required: ['pattern'],
} as const;

/**
 * Input schema for the unsubscribe_events tool.
 * @public
 */
export const UNSUBSCRIBE_EVENTS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    subscriptionId: {
      type: 'string',
      description: 'Subscription ID to unsubscribe',
    },
  },
  required: ['subscriptionId'],
} as const;

/**
 * Input schema for the list_subscriptions tool.
 * @public
 */
export const LIST_SUBSCRIPTIONS_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
} as const;

// Note: Types SubscribeEventsParams and UnsubscribeEventsParams are already exported above
// clearAllSubscriptions is already exported above
