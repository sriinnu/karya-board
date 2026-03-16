/**
 * Karya Core - Main entry point for the task board system.
 * Provides DB, scanner, board generation, events, and agents functionality.
 * @packageDocumentation
 */

// Re-export database types and classes
export {
  Database,
  createDatabase,
  type Result,
} from './db/index.js';
export type {
  Issue,
  Project,
  Artifact,
  IssueStatus,
  IssuePriority,
  IssueSource,
  ProjectStats,
  KaryaConfig,
  ProjectConfig,
} from './db/models.js';

// Re-export RwLock
export {
  RwLock,
  createRwLock,
  type RwLockOptions,
  type RwLockResult,
} from './db/rwlock.js';

// Re-export scanner
export {
  Scanner,
  createScanner,
  FileWatcher,
  type FileEvent,
  type FileEventType,
  type ScanEvent,
  type ScanEventCallback,
  parseFile,
  shouldScanFile,
  ScanDeduplicator,
} from './scanner/index.js';

// Re-export board generator
export {
  BoardGenerator,
  createBoardGenerator,
  type BoardGenOptions,
  type BoardGenResult,
} from './board-gen/index.js';

// Re-export event system
export {
  EventBus,
  createEventBus,
  generateCorrelationId,
} from './events/index.js';
export type {
  KaryaEvent,
  KaryaEventBase,
  EventType,
  EventHandler,
  SubscriptionOptions,
  EventSubscription,
  EventBusOptions,
  // Database events
  DbIssueCreatedEvent,
  DbIssueUpdatedEvent,
  DbIssueDeletedEvent,
  DbProjectCreatedEvent,
  DbProjectDeletedEvent,
  DbArtifactUpsertedEvent,
  IssuePayload,
  // Tool events
  ToolPreExecuteEvent,
  ToolPostExecuteEvent,
  ToolErrorEvent,
  // Agent events
  AgentSpawnedEvent,
  AgentTaskStartedEvent,
  AgentTaskCompletedEvent,
  AgentTaskFailedEvent,
  AgentDisposedEvent,
  // Agent types
  AgentRole,
  AgentCapability,
} from './events/types.js';

// Re-export agent system
export {
  AgentBase,
  AgentRegistry,
  createAgentRegistry,
  type AgentTypeMap,
  // Agent factories
  ReviewerAgent,
  createReviewerAgent,
  ArchitectAgent,
  createArchitectAgent,
  FixerAgent,
  createFixerAgent,
  TriagerAgent,
  createTriagerAgent,
} from './agents/index.js';
export type {
  // Agent config
  AgentConfig,
  AgentInitResult,
  AgentDisposeResult,
  // Skills
  AgentSkill,
  // Task params
  AgentTaskParams,
  ReviewIssueParams,
  SuggestPriorityParams,
  ValidateIssueParams,
  AnalyzeStructureParams,
  SuggestPatternsParams,
  PlanMigrationParams,
  GenerateFixParams,
  ApplyFixParams,
  VerifyFixParams,
  CategorizeIssueParams,
  AssignPriorityParams,
  RouteIssueParams,
  TaskParams,
  // Results
  ReviewIssueResult,
  SuggestPriorityResult,
  ValidateIssueResult,
  AnalyzeStructureResult,
  SuggestPatternsResult,
  PlanMigrationResult,
  GenerateFixResult,
  ApplyFixResult,
  VerifyFixResult,
  CategorizeIssueResult,
  AssignPriorityResult,
  RouteIssueResult,
  TaskResult,
  // Task
  AgentTask,
  // Context
  AgentContext,
  AgentDeps,
  // Registry
  AgentInfo,
  AgentSystemStats,
} from './agents/types.js';

// Re-export logging helpers
export {
  createLogger,
  type Logger,
  type LogLevel,
} from './logger.js';
