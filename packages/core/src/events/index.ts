/**
 * Event system for Karya - pub/sub with pattern matching, history, and async handlers.
 * @packageDocumentation
 */

export {
  EventBus,
  createEventBus,
  generateCorrelationId,
} from './bus.js';

export type {
  // Base types
  KaryaEventBase,
  KaryaEvent,
  EventType,
  EventHandler,
  SubscriptionOptions,
  EventSubscription,
  EventBusOptions,
  // Scanner events
  ScannerEvent,
  ScannerFileDetectedEvent,
  ScannerFileParsedEvent,
  ScannerFileSkippedEvent,
  ScannerFullScanEvent,
  ScannerFileChangeEvent,
  // Database events
  DatabaseEvent,
  DbIssueCreatedEvent,
  DbIssueUpdatedEvent,
  DbIssueDeletedEvent,
  DbProjectCreatedEvent,
  DbProjectDeletedEvent,
  DbArtifactUpsertedEvent,
  IssuePayload,
  // Tool events
  ToolEvent,
  ToolPreExecuteEvent,
  ToolPostExecuteEvent,
  ToolErrorEvent,
  // Agent events
  AgentEvent,
  AgentSpawnedEvent,
  AgentTaskStartedEvent,
  AgentTaskCompletedEvent,
  AgentTaskFailedEvent,
  AgentDisposedEvent,
  // Agent types
  AgentRole,
  AgentCapability,
} from './types.js';
