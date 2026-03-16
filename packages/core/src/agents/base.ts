/**
 * Base class for all Karya agents.
 * Provides common functionality for task execution, event handling, and lifecycle management.
 * @packageDocumentation
 */

import { createLogger } from '../logger.js';
import type { EventBus, EventSubscription } from '../events/index.js';
import type { Database } from '../db/index.js';
import type {
  AgentConfig,
  AgentContext,
  AgentDeps,
  AgentInitResult,
  AgentDisposeResult,
  AgentTask,
  AgentSkill,
  SkillHandler,
  TaskParams,
  TaskResult,
} from './types.js';
import type {
  AgentCapability,
  AgentRole,
  AgentSpawnedEvent,
  AgentDisposedEvent,
  AgentTaskStartedEvent,
  AgentTaskCompletedEvent,
  AgentTaskFailedEvent,
} from '../events/types.js';

/**
 * Generates a unique task ID.
 * @internal
 */
function generateTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Generates a unique agent ID.
 * @internal
 */
function generateAgentId(role: AgentRole): string {
  return `${role}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Abstract base class for all Karya agents.
 *
 * Agents are specialized workers that can perform specific tasks (skills)
 * based on their role. They can subscribe to events and react to changes
 * in the system.
 *
 * @example
 * ```typescript
 * class MyAgent extends AgentBase {
 *   constructor(db: Database, eventBus: EventBus, config: AgentConfig) {
 *     super(db, eventBus, config);
 *     this.registerSkill('my-skill', this.handleMySkill.bind(this));
 *   }
 *
 *   protected getCapabilities(): AgentCapability[] {
 *     return ['read', 'my-skill'];
 *   }
 * }
 * ```
 *
 * @public
 */
export abstract class AgentBase {
  /** Agent unique identifier */
  public readonly id: string;

  /** Agent role */
  public readonly role: AgentRole;

  /** Agent configuration */
  protected readonly config: AgentConfig;

  /** Database instance */
  protected readonly db: Database;

  /** EventBus instance */
  protected readonly eventBus: EventBus;

  /** Logger scoped to this agent */
  protected readonly logger: ReturnType<typeof createLogger>;

  /** Map of skill handlers */
  private skillHandlers = new Map<AgentSkill, SkillHandler<TaskParams, TaskResult>>();

  /** Active tasks being processed */
  private activeTasks = new Map<string, AgentTask>();

  /** Event subscriptions */
  private eventSubscriptions: EventSubscription[] = [];

  /** Whether the agent is initialized */
  private initialized = false;

  /** Whether the agent is disposed */
  private disposed = false;

  /** Counter for completed tasks */
  private tasksCompletedCount = 0;

  /** Counter for failed tasks */
  private tasksFailedCount = 0;

  /**
   * Creates a new AgentBase instance.
   *
   * @param deps - Agent dependencies (db, eventBus)
   * @param config - Agent configuration
   */
  constructor(deps: AgentDeps, config: AgentConfig) {
    this.id = config.id ?? generateAgentId(config.role);
    this.role = config.role;
    this.config = {
      ...config,
      maxConcurrentTasks: config.maxConcurrentTasks ?? 5,
      taskTimeout: config.taskTimeout ?? 60000,
    };
    this.db = deps.db;
    this.eventBus = deps.eventBus;
    this.logger = createLogger(`agent:${this.id}`);
  }

  /**
   * Initializes the agent.
   * Called once before the agent can process tasks.
   *
   * @returns Initialization result
   */
  async initialize(): Promise<AgentInitResult> {
    if (this.initialized) {
      return { success: true };
    }

    if (this.disposed) {
      return { success: false, error: 'Cannot initialize a disposed agent' };
    }

    try {
      // Subscribe to configured event patterns
      if (this.config.subscribeToEvents && this.config.eventPatterns) {
        for (const pattern of this.config.eventPatterns) {
          const subscription = this.eventBus.subscribe(
            pattern,
            this.handleEvent.bind(this)
          );
          this.eventSubscriptions.push(subscription);
        }
      }

      // Call subclass initialization hook
      await this.onInitialize();

      this.initialized = true;

      // Emit agent spawned event
      await this.eventBus.publish({
        type: 'agent:spawned',
        agentId: this.id,
        role: this.role,
        capabilities: this.getCapabilities(),
      } as AgentSpawnedEvent);

      this.logger.info(`Agent initialized: ${this.id} (${this.role})`);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize agent: ${message}`);
      return { success: false, error: message };
    }
  }

  /**
   * Disposes the agent and releases resources.
   *
   * @returns Disposal result
   */
  async dispose(): Promise<AgentDisposeResult> {
    if (this.disposed) {
      return { success: true };
    }

    try {
      // Unsubscribe from all events
      for (const subscription of this.eventSubscriptions) {
        subscription.unsubscribe();
      }
      this.eventSubscriptions = [];

      // Wait for active tasks to complete (with timeout)
      const activeTaskCount = this.activeTasks.size;
      if (activeTaskCount > 0) {
        this.logger.info(`Waiting for ${activeTaskCount} active tasks to complete...`);
        await this.waitForActiveTasks(5000);
      }

      // Call subclass disposal hook
      await this.onDispose();

      this.disposed = true;

      // Emit agent disposed event
      await this.eventBus.publish({
        type: 'agent:disposed',
        agentId: this.id,
        role: this.role,
      } as AgentDisposedEvent);

      this.logger.info(`Agent disposed: ${this.id}`);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to dispose agent: ${message}`);
      return { success: false, error: message };
    }
  }

  /**
   * Submits a task for execution.
   *
   * @param skill - Skill to invoke
   * @param params - Task parameters
   * @returns The created task
   */
  async submitTask<TParams extends TaskParams, TResult extends TaskResult>(
    skill: AgentSkill,
    params: TParams
  ): Promise<AgentTask<TParams, TResult>> {
    if (!this.initialized) {
      throw new Error('Agent not initialized');
    }

    if (this.disposed) {
      throw new Error('Agent has been disposed');
    }

    // Check if skill is supported
    if (!this.skillHandlers.has(skill)) {
      throw new Error(`Agent does not support skill: ${skill}`);
    }

    // Check concurrent task limit
    if (this.activeTasks.size >= (this.config.maxConcurrentTasks ?? 5)) {
      throw new Error(`Agent has reached maximum concurrent tasks (${this.config.maxConcurrentTasks})`);
    }

    const task: AgentTask<TParams, TResult> = {
      id: generateTaskId(),
      skill,
      params,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.activeTasks.set(task.id, task as AgentTask);

    // Execute task asynchronously
    this.executeTask(task).catch((error) => {
      this.logger.error(`Task ${task.id} failed:`, error);
    });

    return task;
  }

  /**
   * Gets the capabilities this agent provides.
   * Must be implemented by subclasses.
   */
  protected abstract getCapabilities(): AgentCapability[];

  /**
   * Called during initialization. Override to add custom init logic.
   */
  protected async onInitialize(): Promise<void> {
    // Override in subclass
  }

  /**
   * Called during disposal. Override to add custom cleanup logic.
   */
  protected async onDispose(): Promise<void> {
    // Override in subclass
  }

  /**
   * Handles events the agent is subscribed to. Override to react to events.
   *
   * @param event - The event that occurred
   */
  protected async handleEvent(event: unknown): Promise<void> {
    // Override in subclass to react to events
    this.logger.debug('Received event:', event);
  }

  /**
   * Registers a skill handler.
   *
   * @param skill - Skill name
   * @param handler - Handler function
   */
  protected registerSkill<TParams extends TaskParams, TResult extends TaskResult>(
    skill: AgentSkill,
    handler: SkillHandler<TParams, TResult>
  ): void {
    this.skillHandlers.set(
      skill,
      handler as unknown as SkillHandler<TaskParams, TaskResult>
    );
  }

  /**
   * Creates the agent context for task execution.
   */
  protected createContext(): AgentContext {
    return {
      db: this.db,
      eventBus: this.eventBus,
      config: this.config,
    };
  }

  /**
   * Executes a task.
   * @internal
   */
  private async executeTask<TParams extends TaskParams, TResult extends TaskResult>(
    task: AgentTask<TParams, TResult>
  ): Promise<void> {
    const handler = this.skillHandlers.get(task.skill);
    if (!handler) {
      task.status = 'failed';
      task.error = new Error(`No handler for skill: ${task.skill}`);
      task.completedAt = Date.now();
      this.tasksFailedCount++;
      this.activeTasks.delete(task.id);
      return;
    }

    task.status = 'running';
    task.startedAt = Date.now();

    // Emit task started event
    await this.eventBus.publish({
      type: 'agent:task:started',
      agentId: this.id,
      taskId: task.id,
      skill: task.skill,
      params: task.params as unknown as Record<string, unknown>,
    } as AgentTaskStartedEvent);

    try {
      // Execute with timeout
      const timeout = this.config.taskTimeout ?? 60000;
      const result = await this.withTimeout(
        handler(task.params, this.createContext()),
        timeout
      );

      task.status = 'completed';
      task.result = result as TResult;
      task.completedAt = Date.now();
      this.tasksCompletedCount++;

      // Emit task completed event
      await this.eventBus.publish({
        type: 'agent:task:completed',
        agentId: this.id,
        taskId: task.id,
        skill: task.skill,
        result: task.result,
        durationMs: task.completedAt - (task.startedAt ?? task.createdAt),
        success: true,
      } as AgentTaskCompletedEvent);
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error : new Error(String(error));
      task.completedAt = Date.now();
      this.tasksFailedCount++;

      // Emit task failed event
      await this.eventBus.publish({
        type: 'agent:task:failed',
        agentId: this.id,
        taskId: task.id,
        skill: task.skill,
        error: task.error,
      } as AgentTaskFailedEvent);
    } finally {
      this.activeTasks.delete(task.id);
    }
  }

  /**
   * Waits for all active tasks to complete with a timeout.
   * @internal
   */
  private async waitForActiveTasks(timeoutMs: number): Promise<void> {
    const startTime = Date.now();

    while (this.activeTasks.size > 0 && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.activeTasks.size > 0) {
      this.logger.warn(`${this.activeTasks.size} tasks did not complete within timeout`);
    }
  }

  /**
   * Wraps a promise with a timeout.
   * @internal
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task timeout after ${timeoutMs}ms`));
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
   * Gets whether the agent is initialized.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Gets whether the agent is disposed.
   */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Gets the number of currently active tasks.
   */
  get currentTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Gets the total number of completed tasks.
   */
  get tasksCompleted(): number {
    return this.tasksCompletedCount;
  }

  /**
   * Gets the total number of failed tasks.
   */
  get tasksFailed(): number {
    return this.tasksFailedCount;
  }

  /**
   * Gets the supported skills for this agent.
   */
  get supportedSkills(): AgentSkill[] {
    return Array.from(this.skillHandlers.keys());
  }
}
