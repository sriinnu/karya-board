/**
 * Agent Registry for managing and spawning Karya agents.
 * Provides factory methods, lifecycle management, and statistics.
 * @packageDocumentation
 */

import { createLogger } from '../logger.js';
import type { EventBus } from '../events/index.js';
import type { Database } from '../db/index.js';
import type {
  AgentConfig,
  AgentDeps,
  AgentInfo,
  AgentSystemStats,
  AgentTask,
  AgentSkill,
  TaskParams,
  TaskResult,
} from './types.js';
import type { AgentRole, AgentCapability } from '../events/types.js';
import { AgentBase } from './base.js';
import { ReviewerAgent, createReviewerAgent } from './reviewer.js';
import { ArchitectAgent, createArchitectAgent } from './architect.js';
import { FixerAgent, createFixerAgent } from './fixer.js';
import { TriagerAgent, createTriagerAgent } from './triager.js';

/**
 * Scoped registry logger.
 * @internal
 */
const logger = createLogger('agent-registry');

/**
 * Agent factory function type.
 */
type AgentFactoryFn = (deps: AgentDeps, config: AgentConfig) => AgentBase;

/**
 * Agent type map for type-safe agent retrieval.
 * @public
 */
export interface AgentTypeMap {
  reviewer: ReviewerAgent;
  architect: ArchitectAgent;
  fixer: FixerAgent;
  triager: TriagerAgent;
}

/**
 * Default capabilities for each agent role.
 * @internal
 */
const DEFAULT_CAPABILITIES: Record<AgentRole, AgentCapability[]> = {
  reviewer: ['read', 'review-issue', 'suggest-priority', 'validate-issue', 'event-subscribe'],
  architect: ['read', 'analyze-structure', 'suggest-patterns', 'plan-migration', 'event-subscribe', 'spawn-agents'],
  fixer: ['read', 'write', 'generate-fix', 'apply-fix', 'verify-fix', 'event-subscribe'],
  triager: ['read', 'write', 'categorize-issue', 'assign-priority', 'route-issue', 'event-subscribe'],
};

/**
 * Default skills for each agent role.
 * @internal
 */
const DEFAULT_SKILLS: Record<AgentRole, AgentSkill[]> = {
  reviewer: ['review-issue', 'suggest-priority', 'validate-issue'],
  architect: ['analyze-structure', 'suggest-patterns', 'plan-migration'],
  fixer: ['generate-fix', 'apply-fix', 'verify-fix'],
  triager: ['categorize-issue', 'assign-priority', 'route-issue'],
};

/**
 * AgentRegistry manages agent lifecycle and provides factory methods.
 *
 * Features:
 * - Spawn agents by role
 * - Track agent statistics
 * - Route tasks to appropriate agents
 * - Manage agent lifecycle
 *
 * @example
 * ```typescript
 * const registry = new AgentRegistry(db, eventBus);
 * await registry.initialize();
 *
 * // Spawn a reviewer agent
 * const reviewer = registry.spawnAgent({ role: 'reviewer' });
 *
 * // Submit a task
 * const task = await reviewer.submitTask('review-issue', { issueId: '123' });
 *
 * // Get system stats
 * const stats = registry.getStats();
 * ```
 *
 * @public
 */
export class AgentRegistry {
  /** Database instance */
  private db: Database;

  /** EventBus instance */
  private eventBus: EventBus;

  /** Map of agent ID to agent instance */
  private agents = new Map<string, AgentBase>();

  /** Map of role to default factory */
  private factories = new Map<AgentRole, AgentFactoryFn>();

  /** Whether the registry has been initialized */
  private initialized = false;

  /**
   * Creates a new AgentRegistry instance.
   *
   * @param db - Database instance
   * @param eventBus - EventBus instance
   */
  constructor(db: Database, eventBus: EventBus) {
    this.db = db;
    this.eventBus = eventBus;

    // Register default factories
    this.registerFactory('reviewer', (deps, config) => createReviewerAgent(deps, config));
    this.registerFactory('architect', (deps, config) => createArchitectAgent(deps, config));
    this.registerFactory('fixer', (deps, config) => createFixerAgent(deps, config));
    this.registerFactory('triager', (deps, config) => createTriagerAgent(deps, config));
  }

  /**
   * Initializes the registry and spawns default agents.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.spawnDefaultAgents();
    this.initialized = true;

    logger.info('Agent registry initialized');
  }

  /**
   * Disposes all agents and cleans up resources.
   */
  async dispose(): Promise<void> {
    const disposePromises = Array.from(this.agents.values()).map((agent) =>
      agent.dispose()
    );

    await Promise.all(disposePromises);
    this.agents.clear();
    this.initialized = false;

    logger.info('Agent registry disposed');
  }

  /**
   * Registers a factory for an agent role.
   *
   * @param role - Agent role
   * @param factory - Factory function
   */
  registerFactory(role: AgentRole, factory: AgentFactoryFn): void {
    this.factories.set(role, factory);
  }

  /**
   * Spawns a new agent with the given configuration.
   *
   * @param config - Agent configuration
   * @returns The spawned agent instance
   */
  spawnAgent<TRole extends AgentRole>(
    config: AgentConfig & { role: TRole }
  ): AgentTypeMap[TRole] {
    const factory = this.factories.get(config.role);
    if (!factory) {
      throw new Error(`No factory registered for role: ${config.role}`);
    }

    const deps: AgentDeps = {
      db: this.db,
      eventBus: this.eventBus,
    };

    const agent = factory(deps, config);
    this.agents.set(agent.id, agent);

    logger.info(`Spawned agent: ${agent.id} (${config.role})`);

    return agent as AgentTypeMap[TRole];
  }

  /**
   * Spawns default agents for all roles.
   */
  async spawnDefaultAgents(): Promise<void> {
    const roles: AgentRole[] = ['reviewer', 'architect', 'fixer', 'triager'];

    for (const role of roles) {
      const agent = this.spawnAgent({ role });
      await agent.initialize();
    }
  }

  /**
   * Gets an agent by ID.
   *
   * @param agentId - Agent ID
   * @returns The agent instance or undefined
   */
  getAgent(agentId: string): AgentBase | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Gets an agent by ID with proper typing.
   *
   * @param agentId - Agent ID
   * @param role - Expected role
   * @returns The typed agent instance or undefined
   */
  getAgentByRole<TRole extends AgentRole>(
    agentId: string,
    role: TRole
  ): AgentTypeMap[TRole] | undefined {
    const agent = this.agents.get(agentId);
    if (agent && agent.role === role) {
      return agent as AgentTypeMap[TRole];
    }
    return undefined;
  }

  /**
   * Gets all agents of a specific role.
   *
   * @param role - Agent role to filter by
   * @returns Array of agents with the specified role
   */
  getAgentsByRole<TRole extends AgentRole>(role: TRole): AgentTypeMap[TRole][] {
    return Array.from(this.agents.values())
      .filter((agent) => agent.role === role) as AgentTypeMap[TRole][];
  }

  /**
   * Gets the first available agent of a specific role.
   *
   * @param role - Agent role
   * @returns First agent with the role or undefined
   */
  getFirstAgentByRole<TRole extends AgentRole>(role: TRole): AgentTypeMap[TRole] | undefined {
    return this.getAgentsByRole(role)[0];
  }

  /**
   * Finds an agent with a specific capability.
   *
   * @param capability - Capability to search for
   * @returns First agent with the capability or undefined
   */
  findAgentWithCapability(capability: AgentCapability): AgentBase | undefined {
    return Array.from(this.agents.values()).find((agent) => {
      const caps = DEFAULT_CAPABILITIES[agent.role];
      return caps.includes(capability);
    });
  }

  /**
   * Finds an agent with a specific skill.
   *
   * @param skill - Skill to search for
   * @returns First agent with the skill or undefined
   */
  findAgentWithSkill(skill: AgentSkill): AgentBase | undefined {
    for (const agent of this.agents.values()) {
      const skills = DEFAULT_SKILLS[agent.role];
      if (skills.includes(skill)) {
        return agent;
      }
    }
    return undefined;
  }

  /**
   * Submits a task to an agent with the required skill.
   *
   * @param skill - Skill required for the task
   * @param params - Task parameters
   * @returns The task result
   */
  async submitTask<TParams extends TaskParams, TResult extends TaskResult>(
    skill: AgentSkill,
    params: TParams
  ): Promise<AgentTask<TParams, TResult>> {
    const agent = this.findAgentWithSkill(skill);
    if (!agent) {
      throw new Error(`No agent available with skill: ${skill}`);
    }

    return agent.submitTask(skill, params) as Promise<AgentTask<TParams, TResult>>;
  }

  /**
   * Disposes a specific agent.
   *
   * @param agentId - Agent ID to dispose
   */
  async disposeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.dispose();
      this.agents.delete(agentId);
    }
  }

  /**
   * Gets information about a specific agent.
   *
   * @param agentId - Agent ID
   * @returns Agent info or undefined
   */
  getAgentInfo(agentId: string): AgentInfo | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return undefined;
    }

    return {
      id: agent.id,
      role: agent.role,
      capabilities: DEFAULT_CAPABILITIES[agent.role],
      active: agent.isInitialized && !agent.isDisposed,
      currentTasks: agent.currentTaskCount,
      tasksCompleted: agent.tasksCompleted,
      tasksFailed: agent.tasksFailed,
    };
  }

  /**
   * Gets information about all agents.
   *
   * @returns Array of agent info
   */
  getAllAgentInfo(): AgentInfo[] {
    return Array.from(this.agents.keys())
      .map((id) => this.getAgentInfo(id))
      .filter((info): info is AgentInfo => info !== undefined);
  }

  /**
   * Gets statistics about the agent system.
   *
   * @returns System statistics
   */
  getStats(): AgentSystemStats {
    const agents = Array.from(this.agents.values());
    const activeAgents = agents.filter((a) => a.isInitialized && !a.isDisposed);

    const agentsByRole: Record<AgentRole, number> = {
      reviewer: 0,
      architect: 0,
      fixer: 0,
      triager: 0,
    };

    for (const agent of agents) {
      agentsByRole[agent.role]++;
    }

    return {
      totalAgents: agents.length,
      activeAgents: activeAgents.length,
      totalTasksCompleted: agents.reduce((sum, a) => sum + a.tasksCompleted, 0),
      totalTasksFailed: agents.reduce((sum, a) => sum + a.tasksFailed, 0),
      agentsByRole,
    };
  }

  /**
   * Gets the number of registered agents.
   */
  get agentCount(): number {
    return this.agents.size;
  }

  /**
   * Gets whether the registry is initialized.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Creates a new AgentRegistry instance.
 *
 * @param db - Database instance
 * @param eventBus - EventBus instance
 * @returns Configured AgentRegistry instance
 * @public
 */
export function createAgentRegistry(db: Database, eventBus: EventBus): AgentRegistry {
  return new AgentRegistry(db, eventBus);
}
