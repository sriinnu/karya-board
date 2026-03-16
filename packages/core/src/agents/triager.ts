/**
 * TriagerAgent - Specialized agent for categorizing and routing issues.
 * Provides skills: categorize-issue, assign-priority, route-issue
 * @packageDocumentation
 */

import { AgentBase } from './base.js';
import type { AgentDeps, AgentConfig, AgentContext } from './types.js';
import type {
  CategorizeIssueParams,
  CategorizeIssueResult,
  AssignPriorityParams,
  AssignPriorityResult,
  RouteIssueParams,
  RouteIssueResult,
} from './types.js';
import type { AgentCapability } from '../events/types.js';
import type { Issue, IssuePriority } from '../db/models.js';

/**
 * Standard issue categories.
 * @public
 */
export const ISSUE_CATEGORIES = [
  'bug',
  'feature',
  'enhancement',
  'documentation',
  'security',
  'performance',
  'refactor',
  'testing',
  'dependencies',
  'infrastructure',
] as const;

/**
 * Standard routing destinations.
 * @public
 */
export const ROUTING_DESTINATIONS = [
  'backend',
  'frontend',
  'devops',
  'security',
  'documentation',
  'testing',
  'database',
  'api',
  'ui',
  'core',
] as const;

/**
 * TriagerAgent provides issue categorization and routing capabilities.
 *
 * Capabilities:
 * - read: Can read issues and project data
 * - write: Can update issue properties
 * - categorize-issue: Categorizes issues into types
 * - assign-priority: Assigns appropriate priority levels
 * - route-issue: Routes issues to appropriate teams/components
 *
 * @example
 * ```typescript
 * const triager = new TriagerAgent(db, eventBus, { role: 'triager' });
 * await triager.initialize();
 *
 * const result = await triager.submitTask('categorize-issue', {
 *   issueId: 'issue-123',
 * });
 * ```
 *
 * @public
 */
export class TriagerAgent extends AgentBase {
  /**
   * Category keywords for classification.
   * @internal
   */
  private categoryKeywords: Map<string, string[]> = new Map([
    ['bug', ['bug', 'error', 'crash', 'fail', 'broken', 'fix', 'issue', 'problem']],
    ['feature', ['feature', 'add', 'new', 'implement', 'create', 'support']],
    ['enhancement', ['improve', 'enhance', 'optimize', 'better', 'update', 'upgrade']],
    ['documentation', ['doc', 'readme', 'comment', 'explain', 'guide', 'tutorial']],
    ['security', ['security', 'vulnerability', 'exploit', 'auth', 'permission', 'xss', 'injection']],
    ['performance', ['performance', 'slow', 'fast', 'optimize', 'memory', 'cpu', 'latency']],
    ['refactor', ['refactor', 'clean', 'restructure', 'reorganize', 'simplify']],
    ['testing', ['test', 'spec', 'coverage', 'unit', 'integration', 'e2e']],
    ['dependencies', ['dependency', 'package', 'version', 'upgrade', 'deprecate']],
    ['infrastructure', ['deploy', 'ci', 'cd', 'docker', 'kubernetes', 'build', 'pipeline']],
  ]);

  /**
   * Routing keywords for destination matching.
   * @internal
   */
  private routingKeywords: Map<string, string[]> = new Map([
    ['backend', ['api', 'server', 'database', 'service', 'endpoint', 'handler']],
    ['frontend', ['ui', 'component', 'css', 'style', 'react', 'vue', 'dom', 'client']],
    ['devops', ['deploy', 'ci', 'cd', 'docker', 'kubernetes', 'pipeline', 'build']],
    ['security', ['auth', 'permission', 'token', 'jwt', 'encryption', 'secure']],
    ['documentation', ['doc', 'readme', 'guide', 'tutorial', 'comment']],
    ['testing', ['test', 'spec', 'mock', 'fixture', 'coverage']],
    ['database', ['sql', 'query', 'migration', 'schema', 'table', 'index']],
    ['api', ['api', 'rest', 'graphql', 'endpoint', 'route', 'request']],
    ['ui', ['button', 'form', 'modal', 'input', 'layout', 'responsive']],
    ['core', ['core', 'main', 'central', 'shared', 'common', 'util']],
  ]);

  /**
   * Creates a new TriagerAgent instance.
   *
   * @param deps - Agent dependencies
   * @param config - Agent configuration (role must be 'triager')
   */
  constructor(deps: AgentDeps, config: AgentConfig) {
    super(deps, { ...config, role: 'triager' });

    // Register skills
    this.registerSkill('categorize-issue', this.handleCategorizeIssue.bind(this));
    this.registerSkill('assign-priority', this.handleAssignPriority.bind(this));
    this.registerSkill('route-issue', this.handleRouteIssue.bind(this));
  }

  /**
   * Gets the capabilities of this agent.
   */
  protected getCapabilities(): AgentCapability[] {
    return ['read', 'write', 'categorize-issue', 'assign-priority', 'route-issue', 'event-subscribe'];
  }

  /**
   * Handles incoming events - auto-triage new issues.
   */
  protected async handleEvent(event: unknown): Promise<void> {
    const typedEvent = event as { type: string; issue?: { id: string } };

    if (typedEvent.type === 'db:issue:created' && typedEvent.issue) {
      // Auto-categorize new issues
      await this.submitTask('categorize-issue', {
        issueId: typedEvent.issue.id,
      });
    }
  }

  /**
   * Handles the categorize-issue skill.
   * Categorizes an issue based on its content.
   */
  private async handleCategorizeIssue(
    params: CategorizeIssueParams,
    context: AgentContext
  ): Promise<CategorizeIssueResult> {
    const issue = this.getIssue(params.issueId, context);
    if (!issue) {
      return {
        category: 'bug', // Default
        confidence: 0,
        alternatives: [],
      };
    }

    const content = `${issue.title} ${issue.description ?? ''}`.toLowerCase();
    const scores = this.calculateCategoryScores(content);

    // Sort by score
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1]);

    const [topCategory, topScore] = sorted[0] ?? ['bug', 0];

    // Build alternatives
    const alternatives = sorted.slice(1, 4).map(([category, score]) => ({
      category,
      confidence: score,
    }));

    // Use provided categories if specified
    if (params.categories && params.categories.length > 0) {
      const filtered = sorted.filter(([cat]) =>
        params.categories!.includes(cat)
      );

      if (filtered.length > 0) {
        const [selected, score] = filtered[0];
        return {
          category: selected,
          confidence: score,
          alternatives: filtered.slice(1, 4).map(([category, s]) => ({
            category,
            confidence: s,
          })),
        };
      }
    }

    return {
      category: topCategory,
      confidence: topScore,
      alternatives,
    };
  }

  /**
   * Handles the assign-priority skill.
   * Assigns a priority level to an issue.
   */
  private async handleAssignPriority(
    params: AssignPriorityParams,
    context: AgentContext
  ): Promise<AssignPriorityResult> {
    const issue = this.getIssue(params.issueId, context);
    if (!issue) {
      return {
        priority: 'medium',
        reasoning: 'Issue not found, defaulting to medium',
      };
    }

    // Analyze for priority signals
    const content = `${issue.title} ${issue.description ?? ''}`.toLowerCase();
    const reasoning: string[] = [];

    let priority: IssuePriority = 'medium';

    // Critical signals
    if (this.hasCriticalSignals(content)) {
      priority = 'critical';
      reasoning.push('Contains critical urgency signals');
    }
    // High signals
    else if (this.hasHighSignals(content)) {
      priority = 'high';
      reasoning.push('Contains high priority signals');
    }
    // Low signals
    else if (this.hasLowSignals(content)) {
      priority = 'low';
      reasoning.push('Contains low priority signals');
    }
    // Default medium
    else {
      reasoning.push('No strong priority signals detected');
    }

    // Apply context reasoning if provided
    if (params.reasoning) {
      reasoning.push(`User context: ${params.reasoning}`);
    }

    // Update the issue if we have write access
    if (issue.priority !== priority) {
      const updateResult = context.db.updateIssue(params.issueId, { priority });
      if (updateResult.success) {
        reasoning.push(`Updated issue priority to ${priority}`);
      }
    }

    return {
      priority,
      reasoning: reasoning.join('; '),
    };
  }

  /**
   * Handles the route-issue skill.
   * Routes an issue to an appropriate destination.
   */
  private async handleRouteIssue(
    params: RouteIssueParams,
    context: AgentContext
  ): Promise<RouteIssueResult> {
    const issue = this.getIssue(params.issueId, context);
    if (!issue) {
      return {
        route: 'core', // Default
        reasoning: 'Issue not found',
        alternatives: [],
      };
    }

    const content = `${issue.title} ${issue.description ?? ''} ${issue.sourceFile ?? ''}`.toLowerCase();
    const scores = this.calculateRoutingScores(content);

    // Sort by score
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1]);

    const [topRoute, topScore] = sorted[0] ?? ['core', 0];

    // Build alternatives
    const alternatives = sorted.slice(1, 4).map(([route]) => route);

    // Use provided routes if specified
    if (params.routes && params.routes.length > 0) {
      const filtered = sorted.filter(([route]) =>
        params.routes!.includes(route)
      );

      if (filtered.length > 0) {
        const [selected] = filtered[0];
        return {
          route: selected,
          reasoning: `Matched ${filtered.length} routing criteria`,
          alternatives: filtered.slice(1, 4).map(([route]) => route),
        };
      }
    }

    return {
      route: topRoute,
      reasoning: topScore > 0.3
        ? `Strong match (${(topScore * 100).toFixed(0)}% confidence)`
        : 'Weak match - manual review recommended',
      alternatives,
    };
  }

  /**
   * Gets an issue by ID from the database.
   */
  private getIssue(issueId: string, context: AgentContext): Issue | null {
    return context.db.getIssueById(issueId);
  }

  /**
   * Calculates category scores based on content.
   */
  private calculateCategoryScores(content: string): Map<string, number> {
    const scores = new Map<string, number>();

    for (const [category, keywords] of this.categoryKeywords) {
      let score = 0;
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          score += 1 / keywords.length;
        }
      }
      // Normalize to 0-1
      scores.set(category, Math.min(1, score));
    }

    return scores;
  }

  /**
   * Calculates routing scores based on content.
   */
  private calculateRoutingScores(content: string): Map<string, number> {
    const scores = new Map<string, number>();

    for (const [route, keywords] of this.routingKeywords) {
      let score = 0;
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          score += 1 / keywords.length;
        }
      }
      // Normalize to 0-1
      scores.set(route, Math.min(1, score));
    }

    return scores;
  }

  /**
   * Checks for critical priority signals.
   */
  private hasCriticalSignals(content: string): boolean {
    const criticalSignals = [
      'critical', 'urgent', 'blocker', 'security', 'vulnerability',
      'exploit', 'production', 'down', 'outage', 'data loss',
    ];

    return criticalSignals.some((signal) => content.includes(signal));
  }

  /**
   * Checks for high priority signals.
   */
  private hasHighSignals(content: string): boolean {
    const highSignals = [
      'important', 'high', 'asap', 'soon', 'customer', 'revenue',
      'bug', 'error', 'fail', 'broken', 'regression',
    ];

    return highSignals.some((signal) => content.includes(signal));
  }

  /**
   * Checks for low priority signals.
   */
  private hasLowSignals(content: string): boolean {
    const lowSignals = [
      'nice to have', 'eventually', 'someday', 'minor', 'polish',
      'refactor', 'cleanup', 'documentation', 'chore',
    ];

    return lowSignals.some((signal) => content.includes(signal));
  }
}

/**
 * Creates a new TriagerAgent instance.
 *
 * @param deps - Agent dependencies
 * @param config - Agent configuration
 * @returns Configured TriagerAgent instance
 * @public
 */
export function createTriagerAgent(deps: AgentDeps, config?: Partial<AgentConfig>): TriagerAgent {
  return new TriagerAgent(deps, { role: 'triager', ...config });
}
