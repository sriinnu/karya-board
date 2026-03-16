/**
 * ReviewerAgent - Specialized agent for reviewing and validating issues.
 * Provides skills: review-issue, suggest-priority, validate-issue
 * @packageDocumentation
 */

import { AgentBase } from './base.js';
import type { AgentDeps, AgentConfig, AgentContext } from './types.js';
import type {
  ReviewIssueParams,
  ReviewIssueResult,
  SuggestPriorityParams,
  SuggestPriorityResult,
  ValidateIssueParams,
  ValidateIssueResult,
} from './types.js';
import type { AgentCapability } from '../events/types.js';
import type { Issue } from '../db/models.js';

/**
 * ReviewerAgent provides read-only analysis and review of issues.
 *
 * Capabilities:
 * - read: Can read issues and project data
 * - review-issue: Provides detailed issue review
 * - suggest-priority: Suggests appropriate priority levels
 * - validate-issue: Validates issue completeness and quality
 *
 * @example
 * ```typescript
 * const reviewer = new ReviewerAgent(db, eventBus, { role: 'reviewer' });
 * await reviewer.initialize();
 *
 * const result = await reviewer.submitTask('review-issue', {
 *   issueId: 'issue-123',
 * });
 * ```
 *
 * @public
 */
export class ReviewerAgent extends AgentBase {
  /**
   * Creates a new ReviewerAgent instance.
   *
   * @param deps - Agent dependencies
   * @param config - Agent configuration (role must be 'reviewer')
   */
  constructor(deps: AgentDeps, config: AgentConfig) {
    super(deps, { ...config, role: 'reviewer' });

    // Register skills
    this.registerSkill('review-issue', this.handleReviewIssue.bind(this));
    this.registerSkill('suggest-priority', this.handleSuggestPriority.bind(this));
    this.registerSkill('validate-issue', this.handleValidateIssue.bind(this));
  }

  /**
   * Gets the capabilities of this agent.
   */
  protected getCapabilities(): AgentCapability[] {
    return ['read', 'review-issue', 'suggest-priority', 'validate-issue', 'event-subscribe'];
  }

  /**
   * Handles the review-issue skill.
   * Provides a comprehensive review of an issue.
   */
  private async handleReviewIssue(
    params: ReviewIssueParams,
    context: AgentContext
  ): Promise<ReviewIssueResult> {
    const issue = this.getIssue(params.issueId, context);
    if (!issue) {
      return {
        assessment: 'rejected',
        feedback: `Issue not found: ${params.issueId}`,
        issues: ['Issue does not exist'],
      };
    }

    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check title quality
    if (issue.title.length < 10) {
      issues.push('Title is too short (should be at least 10 characters)');
      suggestions.push('Expand the title to clearly describe the issue');
    } else if (issue.title.length > 100) {
      issues.push('Title is too long (should be under 100 characters)');
      suggestions.push('Shorten the title and move details to description');
    }

    // Check for description
    if (!issue.description || issue.description.trim().length === 0) {
      issues.push('Issue lacks a description');
      suggestions.push('Add a detailed description explaining the issue');
    } else if (issue.description.length < 20) {
      issues.push('Description is too brief');
      suggestions.push('Expand the description with more context');
    }

    // Check source context
    if (issue.source === 'scanner' && !issue.sourceFile) {
      issues.push('Scanner issue missing source file');
    }

    // Determine assessment
    let assessment: ReviewIssueResult['assessment'];
    if (issues.length === 0) {
      assessment = 'approved';
    } else if (issues.length <= 2 && !issues.some(i => i.includes('not found'))) {
      assessment = 'needs-work';
    } else {
      assessment = 'rejected';
    }

    const feedback = this.generateReviewFeedback(issue, issues, suggestions, params.context);

    return {
      assessment,
      feedback,
      issues: issues.length > 0 ? issues : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  /**
   * Handles the suggest-priority skill.
   * Suggests an appropriate priority level for an issue.
   */
  private async handleSuggestPriority(
    params: SuggestPriorityParams,
    context: AgentContext
  ): Promise<SuggestPriorityResult> {
    const issue = this.getIssue(params.issueId, context);
    if (!issue) {
      return {
        priority: 'medium',
        reasoning: 'Issue not found, defaulting to medium priority',
        confidence: 0.1,
      };
    }

    // Analyze issue for priority signals
    const signals: string[] = [];
    let score = 0;

    // Title analysis
    const titleLower = issue.title.toLowerCase();
    if (titleLower.includes('critical') || titleLower.includes('urgent') || titleLower.includes('blocker')) {
      score += 3;
      signals.push('Title contains urgency keywords');
    }
    if (titleLower.includes('security') || titleLower.includes('vulnerability') || titleLower.includes('exploit')) {
      score += 4;
      signals.push('Security-related issue');
    }
    if (titleLower.includes('bug') || titleLower.includes('fix') || titleLower.includes('error')) {
      score += 1;
      signals.push('Bug fix');
    }
    if (titleLower.includes('feature') || titleLower.includes('enhancement')) {
      score -= 1;
      signals.push('Feature request');
    }

    // Description analysis
    if (issue.description) {
      const descLower = issue.description.toLowerCase();
      if (descLower.includes('production') || descLower.includes('customer') || descLower.includes('user')) {
        score += 2;
        signals.push('Affects production/users');
      }
      if (descLower.includes('workaround')) {
        score -= 1;
        signals.push('Workaround available');
      }
    }

    // Source context
    if (issue.source === 'scanner') {
      score += 0.5; // Scanner issues are often technical debt
      signals.push('Detected by scanner (technical debt)');
    }

    // Apply context if provided
    if (params.context) {
      const contextLower = params.context.toLowerCase();
      if (contextLower.includes('urgent') || contextLower.includes('asap')) {
        score += 2;
        signals.push('Context indicates urgency');
      }
    }

    // Map score to priority
    let priority: SuggestPriorityResult['priority'];
    let confidence: number;

    if (score >= 5) {
      priority = 'critical';
      confidence = 0.85;
    } else if (score >= 3) {
      priority = 'high';
      confidence = 0.75;
    } else if (score >= 1) {
      priority = 'medium';
      confidence = 0.7;
    } else {
      priority = 'low';
      confidence = 0.65;
    }

    const reasoning = signals.length > 0
      ? `Based on: ${signals.join('; ')}`
      : 'No significant priority signals detected';

    return { priority, reasoning, confidence };
  }

  /**
   * Handles the validate-issue skill.
   * Validates issue completeness and quality.
   */
  private async handleValidateIssue(
    params: ValidateIssueParams,
    context: AgentContext
  ): Promise<ValidateIssueResult> {
    const issue = this.getIssue(params.issueId, context);
    if (!issue) {
      return {
        valid: false,
        errors: ['Issue not found'],
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // Required field checks
    if (!issue.title || issue.title.trim().length === 0) {
      errors.push('Title is required');
    }
    if (!issue.projectId) {
      errors.push('Project ID is required');
    }

    // Quality checks
    if (issue.title && issue.title.length < 5) {
      warnings.push('Title is very short and may not be descriptive');
    }
    if (!issue.description || issue.description.trim().length === 0) {
      warnings.push('Description is empty');
    }
    if (issue.status === 'done' && !issue.description) {
      warnings.push('Completed issue lacks description for future reference');
    }

    // Apply custom rules if provided
    if (params.rules) {
      for (const rule of params.rules) {
        const ruleResult = this.applyValidationRule(issue, rule);
        if (ruleResult.error) {
          errors.push(ruleResult.error);
        }
        if (ruleResult.warning) {
          warnings.push(ruleResult.warning);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Gets an issue by ID from the database.
   */
  private getIssue(issueId: string, context: AgentContext): Issue | null {
    return context.db.getIssueById(issueId);
  }

  /**
   * Generates feedback text for a review.
   */
  private generateReviewFeedback(
    issue: Issue,
    issues: string[],
    suggestions: string[],
    context?: string
  ): string {
    const parts: string[] = [];

    parts.push(`Review of "${issue.title}" (${issue.id}):`);

    if (issues.length === 0) {
      parts.push('This issue looks good and is ready to work on.');
    } else {
      parts.push(`Found ${issues.length} issue(s):`);
      issues.forEach((issue, i) => parts.push(`  ${i + 1}. ${issue}`));
    }

    if (suggestions.length > 0) {
      parts.push('Suggestions:');
      suggestions.forEach((s, i) => parts.push(`  ${i + 1}. ${s}`));
    }

    if (context) {
      parts.push(`Additional context: ${context}`);
    }

    return parts.join('\n');
  }

  /**
   * Applies a custom validation rule.
   */
  private applyValidationRule(
    issue: Issue,
    rule: string
  ): { error?: string; warning?: string } {
    // Simple rule matching
    switch (rule.toLowerCase()) {
      case 'has-description':
        if (!issue.description) {
          return { error: 'Issue must have a description' };
        }
        break;
      case 'has-source-file':
        if (!issue.sourceFile) {
          return { warning: 'No source file associated' };
        }
        break;
      case 'not-done-without-description':
        if (issue.status === 'done' && !issue.description) {
          return { error: 'Completed issues should have descriptions' };
        }
        break;
      default:
        // Unknown rule - ignore
        break;
    }

    return {};
  }
}

/**
 * Creates a new ReviewerAgent instance.
 *
 * @param deps - Agent dependencies
 * @param config - Agent configuration
 * @returns Configured ReviewerAgent instance
 * @public
 */
export function createReviewerAgent(deps: AgentDeps, config?: Partial<AgentConfig>): ReviewerAgent {
  return new ReviewerAgent(deps, { role: 'reviewer', ...config });
}
