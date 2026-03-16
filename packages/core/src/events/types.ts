/**
 * Event type definitions for the Karya EventBus system.
 * Provides strongly-typed events for scanner, database, tool, and agent operations.
 * @packageDocumentation
 */

import type { IssueStatus, IssuePriority, IssueSource } from '../db/models.js';

// ==================== Base Event Types ====================

/**
 * Base interface for all Karya events.
 * @public
 */
export interface KaryaEventBase {
  /** Event type identifier (e.g., 'db:issue:created') */
  type: string;
  /** Timestamp when the event occurred (Unix epoch in milliseconds) */
  timestamp: number;
  /** Optional correlation ID for tracing related events */
  correlationId?: string;
}

// ==================== Scanner Events ====================

/**
 * Event emitted when a file is detected by the scanner.
 * @public
 */
export interface ScannerFileDetectedEvent extends KaryaEventBase {
  type: 'scanner:file:detected';
  /** Absolute path to the detected file */
  filePath: string;
  /** Project ID the file belongs to */
  projectId: string;
}

/**
 * Event emitted when a file is successfully parsed.
 * @public
 */
export interface ScannerFileParsedEvent extends KaryaEventBase {
  type: 'scanner:file:parsed';
  /** Absolute path to the parsed file */
  filePath: string;
  /** Project ID the file belongs to */
  projectId: string;
  /** Number of issues extracted from the file */
  issueCount: number;
}

/**
 * Event emitted when a file is skipped during scanning.
 * @public
 */
export interface ScannerFileSkippedEvent extends KaryaEventBase {
  type: 'scanner:file:skipped';
  /** Absolute path to the skipped file */
  filePath: string;
  /** Project ID the file belongs to */
  projectId?: string;
  /** Reason the file was skipped */
  reason: 'too_large' | 'binary' | 'encoding' | 'excluded' | 'error';
  /** Optional error message if skipped due to error */
  error?: string;
}

/**
 * Event emitted when a full scan completes.
 * @public
 */
export interface ScannerFullScanEvent extends KaryaEventBase {
  type: 'scanner:full-scan';
  /** Project ID that was scanned */
  projectId?: string;
  /** Total number of files processed */
  fileCount: number;
  /** Total number of issues found */
  issueCount: number;
  /** Any errors encountered during scan */
  errors?: Error[];
}

/**
 * Event emitted when a file change is detected by the watcher.
 * @public
 */
export interface ScannerFileChangeEvent extends KaryaEventBase {
  type: 'scanner:file:change';
  /** Absolute path to the changed file */
  filePath: string;
  /** Project ID the file belongs to */
  projectId: string;
  /** Type of file change */
  changeType: 'create' | 'update' | 'delete';
}

/**
 * All scanner event types.
 * @public
 */
export type ScannerEvent =
  | ScannerFileDetectedEvent
  | ScannerFileParsedEvent
  | ScannerFileSkippedEvent
  | ScannerFullScanEvent
  | ScannerFileChangeEvent;

// ==================== Database Events ====================

/**
 * Event payload for issue mutations.
 * @public
 */
export interface IssuePayload {
  /** The issue ID */
  id: string;
  /** Project ID the issue belongs to */
  projectId: string;
  /** Issue title */
  title: string;
  /** Issue status */
  status: IssueStatus;
  /** Issue priority */
  priority: IssuePriority;
  /** Issue source */
  source: IssueSource;
}

/**
 * Event emitted when an issue is created.
 * @public
 */
export interface DbIssueCreatedEvent extends KaryaEventBase {
  type: 'db:issue:created';
  /** The created issue data */
  issue: IssuePayload;
}

/**
 * Event emitted when an issue is updated.
 * @public
 */
export interface DbIssueUpdatedEvent extends KaryaEventBase {
  type: 'db:issue:updated';
  /** The updated issue data */
  issue: IssuePayload;
  /** Previous values before update */
  previous?: Partial<IssuePayload>;
}

/**
 * Event emitted when an issue is deleted.
 * @public
 */
export interface DbIssueDeletedEvent extends KaryaEventBase {
  type: 'db:issue:deleted';
  /** The deleted issue ID */
  issueId: string;
  /** Project ID the issue belonged to */
  projectId: string;
}

/**
 * Event emitted when a project is created.
 * @public
 */
export interface DbProjectCreatedEvent extends KaryaEventBase {
  type: 'db:project:created';
  /** Project ID */
  projectId: string;
  /** Project name */
  name: string;
  /** Project path */
  path: string;
}

/**
 * Event emitted when a project is deleted.
 * @public
 */
export interface DbProjectDeletedEvent extends KaryaEventBase {
  type: 'db:project:deleted';
  /** Deleted project ID */
  projectId: string;
}

/**
 * Event emitted when an artifact is upserted.
 * @public
 */
export interface DbArtifactUpsertedEvent extends KaryaEventBase {
  type: 'db:artifact:upserted';
  /** Artifact ID */
  artifactId: string;
  /** Project ID */
  projectId: string;
  /** File path */
  filePath: string;
}

/**
 * All database event types.
 * @public
 */
export type DatabaseEvent =
  | DbIssueCreatedEvent
  | DbIssueUpdatedEvent
  | DbIssueDeletedEvent
  | DbProjectCreatedEvent
  | DbProjectDeletedEvent
  | DbArtifactUpsertedEvent;

// ==================== Tool Events ====================

/**
 * Event emitted before a tool is executed.
 * @public
 */
export interface ToolPreExecuteEvent extends KaryaEventBase {
  type: 'tool:pre-execute';
  /** Name of the tool being executed */
  toolName: string;
  /** Parameters passed to the tool */
  params: Record<string, unknown>;
}

/**
 * Event emitted after a tool successfully executes.
 * @public
 */
export interface ToolPostExecuteEvent extends KaryaEventBase {
  type: 'tool:post-execute';
  /** Name of the tool that was executed */
  toolName: string;
  /** Parameters that were passed */
  params: Record<string, unknown>;
  /** Result from the tool */
  result: unknown;
  /** Duration of execution in milliseconds */
  durationMs: number;
}

/**
 * Event emitted when a tool execution fails.
 * @public
 */
export interface ToolErrorEvent extends KaryaEventBase {
  type: 'tool:error';
  /** Name of the tool that failed */
  toolName: string;
  /** Parameters that were passed */
  params: Record<string, unknown>;
  /** Error that occurred */
  error: Error;
  /** Duration before failure in milliseconds */
  durationMs: number;
}

/**
 * All tool event types.
 * @public
 */
export type ToolEvent =
  | ToolPreExecuteEvent
  | ToolPostExecuteEvent
  | ToolErrorEvent;

// ==================== Agent Events ====================

/**
 * Event emitted when an agent is spawned.
 * @public
 */
export interface AgentSpawnedEvent extends KaryaEventBase {
  type: 'agent:spawned';
  /** Agent ID */
  agentId: string;
  /** Agent role */
  role: AgentRole;
  /** Agent capabilities */
  capabilities: AgentCapability[];
}

/**
 * Event emitted when an agent starts a task.
 * @public
 */
export interface AgentTaskStartedEvent extends KaryaEventBase {
  type: 'agent:task:started';
  /** Agent ID */
  agentId: string;
  /** Task ID */
  taskId: string;
  /** Skill being invoked */
  skill: string;
  /** Task parameters */
  params: Record<string, unknown>;
}

/**
 * Event emitted when an agent completes a task.
 * @public
 */
export interface AgentTaskCompletedEvent extends KaryaEventBase {
  type: 'agent:task:completed';
  /** Agent ID */
  agentId: string;
  /** Task ID */
  taskId: string;
  /** Skill that was invoked */
  skill: string;
  /** Task result */
  result: unknown;
  /** Duration of task in milliseconds */
  durationMs: number;
  /** Whether the task succeeded */
  success: boolean;
}

/**
 * Event emitted when an agent task fails.
 * @public
 */
export interface AgentTaskFailedEvent extends KaryaEventBase {
  type: 'agent:task:failed';
  /** Agent ID */
  agentId: string;
  /** Task ID */
  taskId: string;
  /** Skill that was invoked */
  skill: string;
  /** Error that occurred */
  error: Error;
}

/**
 * Event emitted when an agent is disposed.
 * @public
 */
export interface AgentDisposedEvent extends KaryaEventBase {
  type: 'agent:disposed';
  /** Agent ID */
  agentId: string;
  /** Agent role */
  role: AgentRole;
}

/**
 * All agent event types.
 * @public
 */
export type AgentEvent =
  | AgentSpawnedEvent
  | AgentTaskStartedEvent
  | AgentTaskCompletedEvent
  | AgentTaskFailedEvent
  | AgentDisposedEvent;

// ==================== Agent Types ====================

/**
 * Agent roles defining their specialization.
 * @public
 */
export type AgentRole = 'reviewer' | 'architect' | 'fixer' | 'triager';

/**
 * Capabilities an agent can have.
 * @public
 */
export type AgentCapability =
  | 'read'
  | 'write'
  | 'review-issue'
  | 'suggest-priority'
  | 'validate-issue'
  | 'analyze-structure'
  | 'suggest-patterns'
  | 'plan-migration'
  | 'generate-fix'
  | 'apply-fix'
  | 'verify-fix'
  | 'categorize-issue'
  | 'assign-priority'
  | 'route-issue'
  | 'event-subscribe'
  | 'spawn-agents';

/**
 * All Karya event types union.
 * @public
 */
export type KaryaEvent = ScannerEvent | DatabaseEvent | ToolEvent | AgentEvent;

/**
 * Event type string literals for type-safe subscription.
 * @public
 */
export type EventType =
  // Scanner events
  | 'scanner:file:detected'
  | 'scanner:file:parsed'
  | 'scanner:file:skipped'
  | 'scanner:full-scan'
  | 'scanner:file:change'
  // Database events
  | 'db:issue:created'
  | 'db:issue:updated'
  | 'db:issue:deleted'
  | 'db:project:created'
  | 'db:project:deleted'
  | 'db:artifact:upserted'
  // Tool events
  | 'tool:pre-execute'
  | 'tool:post-execute'
  | 'tool:error'
  // Agent events
  | 'agent:spawned'
  | 'agent:task:started'
  | 'agent:task:completed'
  | 'agent:task:failed'
  | 'agent:disposed';

/**
 * Event handler function type.
 * @public
 */
export type EventHandler<T extends KaryaEvent = KaryaEvent> = (event: T) => void | Promise<void>;

/**
 * Subscription options.
 * @public
 */
export interface SubscriptionOptions {
  /** Unique identifier for the subscription */
  id?: string;
  /** Whether to include past events from history */
  replay?: boolean;
  /** Maximum number of events to replay */
  replayLimit?: number;
  /** Handler timeout in milliseconds */
  timeout?: number;
}

/**
 * Event subscription returned from subscribe().
 * @public
 */
export interface EventSubscription {
  /** Unique subscription ID */
  id: string;
  /** Pattern this subscription matches */
  pattern: string;
  /** Unsubscribe from further events */
  unsubscribe: () => void;
  /** Whether the subscription is active */
  active: boolean;
}

/**
 * EventBus configuration options.
 * @public
 */
export interface EventBusOptions {
  /** Maximum number of events to keep in history */
  maxHistorySize?: number;
  /** Default timeout for async handlers in milliseconds */
  defaultHandlerTimeout?: number;
  /** Whether to catch and log handler errors instead of throwing */
  catchHandlerErrors?: boolean;
}
