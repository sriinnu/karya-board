/**
 * Agent system for Karya - specialized agents for issue management and analysis.
 * @packageDocumentation
 */

// Base exports
export { AgentBase } from './base.js';

// Registry
export {
  AgentRegistry,
  createAgentRegistry,
  type AgentTypeMap,
} from './registry.js';

// Specialized agents
export {
  ReviewerAgent,
  createReviewerAgent,
} from './reviewer.js';

export {
  ArchitectAgent,
  createArchitectAgent,
} from './architect.js';

export {
  FixerAgent,
  createFixerAgent,
} from './fixer.js';

export {
  TriagerAgent,
  createTriagerAgent,
  ISSUE_CATEGORIES,
  ROUTING_DESTINATIONS,
} from './triager.js';

// Re-export types
export type {
  // Configuration
  AgentConfig,
  AgentInitResult,
  AgentDisposeResult,
  // Tasks
  ReviewerSkill,
  ArchitectSkill,
  FixerSkill,
  TriagerSkill,
  AgentSkill,
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
  // Handlers
  SkillHandler,
  SkillHandlerMap,
  // Registry
  AgentFactory,
  AgentInfo,
  AgentSystemStats,
} from './types.js';
