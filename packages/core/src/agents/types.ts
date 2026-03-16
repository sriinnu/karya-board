/**
 * Agent type definitions for the Karya agent system.
 * Provides types for agent roles, skills, tasks, and configurations.
 * @packageDocumentation
 */

import type { EventBus } from '../events/index.js';
import type { Database } from '../db/index.js';
import type { Issue } from '../db/models.js';
import type { AgentRole, AgentCapability } from '../events/types.js';

// ==================== Agent Configuration ====================

/**
 * Configuration for creating an agent.
 * @public
 */
export interface AgentConfig {
  /** Unique identifier for this agent instance */
  id?: string;
  /** Agent role (determines default skills and capabilities) */
  role: AgentRole;
  /** Optional description of this agent's purpose */
  description?: string;
  /** Maximum concurrent tasks this agent can handle */
  maxConcurrentTasks?: number;
  /** Timeout for individual task execution in milliseconds */
  taskTimeout?: number;
  /** Whether this agent should subscribe to events */
  subscribeToEvents?: boolean;
  /** Event patterns this agent should subscribe to */
  eventPatterns?: string[];
}

/**
 * Result of agent initialization.
 * @public
 */
export interface AgentInitResult {
  /** Whether initialization succeeded */
  success: boolean;
  /** Error message if initialization failed */
  error?: string;
}

/**
 * Result of agent disposal.
 * @public
 */
export interface AgentDisposeResult {
  /** Whether disposal succeeded */
  success: boolean;
  /** Error message if disposal failed */
  error?: string;
}

// ==================== Agent Tasks ====================

/**
 * Skill identifiers for each agent role.
 * @public
 */
export type ReviewerSkill =
  | 'review-issue'
  | 'suggest-priority'
  | 'validate-issue';

export type ArchitectSkill =
  | 'analyze-structure'
  | 'suggest-patterns'
  | 'plan-migration';

export type FixerSkill =
  | 'generate-fix'
  | 'apply-fix'
  | 'verify-fix';

export type TriagerSkill =
  | 'categorize-issue'
  | 'assign-priority'
  | 'route-issue';

/**
 * All possible skill types.
 * @public
 */
export type AgentSkill = ReviewerSkill | ArchitectSkill | FixerSkill | TriagerSkill;

/**
 * Base task parameters.
 * @public
 */
export interface AgentTaskParams {
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Priority of this task (higher = more urgent) */
  priority?: number;
}

/**
 * Task parameters for reviewing an issue.
 * @public
 */
export interface ReviewIssueParams extends AgentTaskParams {
  /** Issue ID to review */
  issueId: string;
  /** Optional context for the review */
  context?: string;
}

/**
 * Task parameters for suggesting priority.
 * @public
 */
export interface SuggestPriorityParams extends AgentTaskParams {
  /** Issue ID to analyze */
  issueId: string;
  /** Additional context for priority decision */
  context?: string;
}

/**
 * Task parameters for validating an issue.
 * @public
 */
export interface ValidateIssueParams extends AgentTaskParams {
  /** Issue ID to validate */
  issueId: string;
  /** Validation rules to apply */
  rules?: string[];
}

/**
 * Task parameters for analyzing structure.
 * @public
 */
export interface AnalyzeStructureParams extends AgentTaskParams {
  /** Project ID to analyze */
  projectId: string;
  /** Specific aspect to analyze */
  aspect?: 'dependencies' | 'patterns' | 'complexity' | 'all';
}

/**
 * Task parameters for suggesting patterns.
 * @public
 */
export interface SuggestPatternsParams extends AgentTaskParams {
  /** Project ID to analyze */
  projectId: string;
  /** Type of patterns to suggest */
  patternType?: 'architectural' | 'code' | 'testing' | 'all';
}

/**
 * Task parameters for planning migration.
 * @public
 */
export interface PlanMigrationParams extends AgentTaskParams {
  /** Project ID */
  projectId: string;
  /** Migration target (e.g., new framework version) */
  target: string;
  /** Specific components to migrate */
  components?: string[];
}

/**
 * Task parameters for generating a fix.
 * @public
 */
export interface GenerateFixParams extends AgentTaskParams {
  /** Issue ID to fix */
  issueId: string;
  /** Optional approach to use */
  approach?: string;
}

/**
 * Task parameters for applying a fix.
 * @public
 */
export interface ApplyFixParams extends AgentTaskParams {
  /** Issue ID being fixed */
  issueId: string;
  /** Fix content to apply */
  fix: string;
  /** Whether to verify after applying */
  verify?: boolean;
}

/**
 * Task parameters for verifying a fix.
 * @public
 */
export interface VerifyFixParams extends AgentTaskParams {
  /** Issue ID that was fixed */
  issueId: string;
  /** Expected outcome */
  expectedOutcome?: string;
}

/**
 * Task parameters for categorizing an issue.
 * @public
 */
export interface CategorizeIssueParams extends AgentTaskParams {
  /** Issue ID to categorize */
  issueId: string;
  /** Existing categories to choose from */
  categories?: string[];
}

/**
 * Task parameters for assigning priority.
 * @public
 */
export interface AssignPriorityParams extends AgentTaskParams {
  /** Issue ID */
  issueId: string;
  /** Reasoning for the priority */
  reasoning?: string;
}

/**
 * Task parameters for routing an issue.
 * @public
 */
export interface RouteIssueParams extends AgentTaskParams {
  /** Issue ID to route */
  issueId: string;
  /** Available routes (e.g., team names, component areas) */
  routes?: string[];
}

/**
 * Union of all task parameter types.
 * @public
 */
export type TaskParams =
  | ReviewIssueParams
  | SuggestPriorityParams
  | ValidateIssueParams
  | AnalyzeStructureParams
  | SuggestPatternsParams
  | PlanMigrationParams
  | GenerateFixParams
  | ApplyFixParams
  | VerifyFixParams
  | CategorizeIssueParams
  | AssignPriorityParams
  | RouteIssueParams;

// ==================== Agent Results ====================

/**
 * Result of reviewing an issue.
 * @public
 */
export interface ReviewIssueResult {
  /** Overall assessment */
  assessment: 'approved' | 'needs-work' | 'rejected';
  /** Detailed feedback */
  feedback: string;
  /** Specific issues found */
  issues?: string[];
  /** Suggestions for improvement */
  suggestions?: string[];
}

/**
 * Result of suggesting priority.
 * @public
 */
export interface SuggestPriorityResult {
  /** Suggested priority level */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** Reasoning for the suggestion */
  reasoning: string;
  /** Confidence level (0-1) */
  confidence: number;
}

/**
 * Result of validating an issue.
 * @public
 */
export interface ValidateIssueResult {
  /** Whether the issue is valid */
  valid: boolean;
  /** Validation errors if any */
  errors?: string[];
  /** Warnings (non-fatal issues) */
  warnings?: string[];
}

/**
 * Result of structure analysis.
 * @public
 */
export interface AnalyzeStructureResult {
  /** Analysis summary */
  summary: string;
  /** Key findings */
  findings: string[];
  /** Metrics collected */
  metrics?: Record<string, number | string>;
  /** Recommendations */
  recommendations?: string[];
}

/**
 * Result of pattern suggestions.
 * @public
 */
export interface SuggestPatternsResult {
  /** Suggested patterns */
  patterns: Array<{
    name: string;
    description: string;
    applicability: string;
    priority: 'high' | 'medium' | 'low';
  }>;
}

/**
 * Result of migration planning.
 * @public
 */
export interface PlanMigrationResult {
  /** Migration plan steps */
  steps: Array<{
    order: number;
    description: string;
    estimatedEffort: 'low' | 'medium' | 'high';
    dependencies?: string[];
  }>;
  /** Overall risk assessment */
  risk: 'low' | 'medium' | 'high';
  /** Estimated total effort */
  estimatedEffort: string;
}

/**
 * Result of generating a fix.
 * @public
 */
export interface GenerateFixResult {
  /** Generated fix content */
  fix: string;
  /** Description of what the fix does */
  description: string;
  /** Files that would be affected */
  affectedFiles?: string[];
  /** Confidence in the fix (0-1) */
  confidence: number;
}

/**
 * Result of applying a fix.
 * @public
 */
export interface ApplyFixResult {
  /** Whether the fix was applied successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Changes made */
  changes?: string[];
}

/**
 * Result of verifying a fix.
 * @public
 */
export interface VerifyFixResult {
  /** Whether the fix is verified */
  verified: boolean;
  /** Verification details */
  details: string;
  /** Remaining issues if any */
  remainingIssues?: string[];
}

/**
 * Result of categorizing an issue.
 * @public
 */
export interface CategorizeIssueResult {
  /** Assigned category */
  category: string;
  /** Confidence in the categorization (0-1) */
  confidence: number;
  /** Alternative categories considered */
  alternatives?: Array<{ category: string; confidence: number }>;
}

/**
 * Result of assigning priority.
 * @public
 */
export interface AssignPriorityResult {
  /** Assigned priority */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** Reasoning */
  reasoning: string;
}

/**
 * Result of routing an issue.
 * @public
 */
export interface RouteIssueResult {
  /** Selected route */
  route: string;
  /** Reasoning for the routing decision */
  reasoning: string;
  /** Alternative routes considered */
  alternatives?: string[];
}

/**
 * Union of all result types.
 * @public
 */
export type TaskResult =
  | ReviewIssueResult
  | SuggestPriorityResult
  | ValidateIssueResult
  | AnalyzeStructureResult
  | SuggestPatternsResult
  | PlanMigrationResult
  | GenerateFixResult
  | ApplyFixResult
  | VerifyFixResult
  | CategorizeIssueResult
  | AssignPriorityResult
  | RouteIssueResult;

// ==================== Agent Task ====================

/**
 * A task submitted to an agent.
 * @public
 */
export interface AgentTask<TParams extends TaskParams = TaskParams, TResult extends TaskResult = TaskResult> {
  /** Unique task ID */
  id: string;
  /** Skill to invoke */
  skill: AgentSkill;
  /** Task parameters */
  params: TParams;
  /** Task status */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Result when completed */
  result?: TResult;
  /** Error if failed */
  error?: Error;
  /** Timestamp when task was created */
  createdAt: number;
  /** Timestamp when task started */
  startedAt?: number;
  /** Timestamp when task completed */
  completedAt?: number;
}

// ==================== Agent Context ====================

/**
 * Context provided to agents for task execution.
 * @public
 */
export interface AgentContext {
  /** Database instance for data access */
  db: Database;
  /** EventBus for publishing/subscribing to events */
  eventBus: EventBus;
  /** Agent configuration */
  config: AgentConfig;
  /** Issue being processed (if applicable) */
  issue?: Issue;
  /** Additional context data */
  context?: Record<string, unknown>;
}

/**
 * Dependencies required by agents.
 * @public
 */
export interface AgentDeps {
  /** Database instance */
  db: Database;
  /** EventBus instance */
  eventBus: EventBus;
}

// ==================== Skill Handlers ====================

/**
 * Function type for handling a skill.
 * @public
 */
export type SkillHandler<TParams extends TaskParams, TResult extends TaskResult> = (
  params: TParams,
  context: AgentContext
) => Promise<TResult>;

/**
 * Map of skill names to their handlers.
 * @public
 */
export type SkillHandlerMap = Map<AgentSkill, SkillHandler<TaskParams, TaskResult>>;

// ==================== Registry Types ====================

/**
 * Agent factory function type.
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentFactory = (deps: AgentDeps, config: AgentConfig) => any;

/**
 * Information about a registered agent.
 * @public
 */
export interface AgentInfo {
  /** Agent ID */
  id: string;
  /** Agent role */
  role: AgentRole;
  /** Agent capabilities */
  capabilities: AgentCapability[];
  /** Whether the agent is currently active */
  active: boolean;
  /** Number of tasks currently being processed */
  currentTasks: number;
  /** Total tasks completed */
  tasksCompleted: number;
  /** Total tasks failed */
  tasksFailed: number;
}

/**
 * Statistics about the agent system.
 * @public
 */
export interface AgentSystemStats {
  /** Total number of agents */
  totalAgents: number;
  /** Number of active agents */
  activeAgents: number;
  /** Total tasks completed across all agents */
  totalTasksCompleted: number;
  /** Total tasks failed across all agents */
  totalTasksFailed: number;
  /** Agents by role */
  agentsByRole: Record<AgentRole, number>;
}
