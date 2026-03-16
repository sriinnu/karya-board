/**
 * FixerAgent - Specialized agent for generating and applying fixes.
 * Provides skills: generate-fix, apply-fix, verify-fix
 * @packageDocumentation
 */

import { AgentBase } from './base.js';
import type { AgentDeps, AgentConfig, AgentContext } from './types.js';
import type {
  GenerateFixParams,
  GenerateFixResult,
  ApplyFixParams,
  ApplyFixResult,
  VerifyFixParams,
  VerifyFixResult,
} from './types.js';
import type { AgentCapability } from '../events/types.js';
import type { Issue } from '../db/models.js';

/**
 * FixerAgent provides fix generation and application capabilities.
 *
 * Capabilities:
 * - read: Can read issues and project data
 * - write: Can modify data (with caution)
 * - generate-fix: Generates fix suggestions for issues
 * - apply-fix: Applies fixes to issues
 * - verify-fix: Verifies that fixes are working
 *
 * @example
 * ```typescript
 * const fixer = new FixerAgent(db, eventBus, { role: 'fixer' });
 * await fixer.initialize();
 *
 * const result = await fixer.submitTask('generate-fix', {
 *   issueId: 'issue-123',
 * });
 * ```
 *
 * @public
 */
export class FixerAgent extends AgentBase {
  /**
   * Creates a new FixerAgent instance.
   *
   * @param deps - Agent dependencies
   * @param config - Agent configuration (role must be 'fixer')
   */
  constructor(deps: AgentDeps, config: AgentConfig) {
    super(deps, { ...config, role: 'fixer' });

    // Register skills
    this.registerSkill('generate-fix', this.handleGenerateFix.bind(this));
    this.registerSkill('apply-fix', this.handleApplyFix.bind(this));
    this.registerSkill('verify-fix', this.handleVerifyFix.bind(this));
  }

  /**
   * Gets the capabilities of this agent.
   */
  protected getCapabilities(): AgentCapability[] {
    return ['read', 'write', 'generate-fix', 'apply-fix', 'verify-fix', 'event-subscribe'];
  }

  /**
   * Handles the generate-fix skill.
   * Generates a fix suggestion for an issue.
   */
  private async handleGenerateFix(
    params: GenerateFixParams,
    context: AgentContext
  ): Promise<GenerateFixResult> {
    const issue = this.getIssue(params.issueId, context);
    if (!issue) {
      return {
        fix: '',
        description: `Issue not found: ${params.issueId}`,
        confidence: 0,
      };
    }

    // Analyze the issue and generate a fix suggestion
    const analysis = this.analyzeIssue(issue);
    const fix = this.generateFixContent(issue, analysis, params.approach);
    const description = this.generateFixDescription(issue, analysis);
    const affectedFiles = this.identifyAffectedFiles(issue, analysis);
    const confidence = this.calculateConfidence(issue, analysis);

    return {
      fix,
      description,
      affectedFiles,
      confidence,
    };
  }

  /**
   * Handles the apply-fix skill.
   * Applies a fix to an issue.
   * Note: In a real implementation, this would modify files or database.
   * Here we simulate the application and update issue status.
   */
  private async handleApplyFix(
    params: ApplyFixParams,
    context: AgentContext
  ): Promise<ApplyFixResult> {
    const issue = this.getIssue(params.issueId, context);
    if (!issue) {
      return {
        success: false,
        error: `Issue not found: ${params.issueId}`,
      };
    }

    try {
      // Simulate applying the fix
      // In a real implementation, this would:
      // 1. Write the fix to the appropriate file(s)
      // 2. Run any necessary build/test commands
      // 3. Update the issue status

      const changes: string[] = [];

      // Update issue status to in_progress when applying fix
      if (issue.status === 'open') {
        const updateResult = context.db.updateIssue(params.issueId, {
          status: 'in_progress',
        });

        if (updateResult.success) {
          changes.push('Updated issue status to in_progress');
        }
      }

      // If verification is requested, do it
      if (params.verify) {
        const verifyResult = await this.handleVerifyFix(
          { issueId: params.issueId, expectedOutcome: 'Issue resolved' },
          context
        );

        if (verifyResult.verified) {
          changes.push('Fix verified successfully');
        } else {
          return {
            success: false,
            error: `Fix verification failed: ${verifyResult.details}`,
            changes,
          };
        }
      }

      return {
        success: true,
        changes,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handles the verify-fix skill.
   * Verifies that a fix has been properly applied.
   */
  private async handleVerifyFix(
    params: VerifyFixParams,
    context: AgentContext
  ): Promise<VerifyFixResult> {
    const issue = this.getIssue(params.issueId, context);
    if (!issue) {
      return {
        verified: false,
        details: `Issue not found: ${params.issueId}`,
      };
    }

    const remainingIssues: string[] = [];
    let verified = true;
    const details: string[] = [];

    // Check if issue has been addressed
    if (issue.status === 'done') {
      details.push('Issue is marked as done');
    } else if (issue.status === 'in_progress') {
      details.push('Issue is in progress');
      // Still consider it partially verified
    } else {
      details.push('Issue is still open');
      remainingIssues.push('Issue has not been resolved');
      verified = false;
    }

    // Check for description updates
    if (issue.description && issue.description.length > 50) {
      details.push('Issue has detailed description');
    } else {
      remainingIssues.push('Issue lacks detailed description');
    }

    // Check expected outcome if provided
    if (params.expectedOutcome) {
      const outcomeMatch = this.checkExpectedOutcome(issue, params.expectedOutcome);
      if (!outcomeMatch) {
        remainingIssues.push('Expected outcome not achieved');
        verified = false;
      } else {
        details.push('Expected outcome matches');
      }
    }

    return {
      verified,
      details: details.join('; '),
      remainingIssues: remainingIssues.length > 0 ? remainingIssues : undefined,
    };
  }

  /**
   * Gets an issue by ID from the database.
   */
  private getIssue(issueId: string, context: AgentContext): Issue | null {
    return context.db.getIssueById(issueId);
  }

  /**
   * Analyzes an issue to understand its nature.
   */
  private analyzeIssue(issue: Issue): {
    type: 'bug' | 'feature' | 'refactor' | 'docs' | 'unknown';
    complexity: 'low' | 'medium' | 'high';
    keywords: string[];
  } {
    const titleLower = issue.title.toLowerCase();
    const descLower = (issue.description ?? '').toLowerCase();
    const combined = `${titleLower} ${descLower}`;

    const keywords: string[] = [];

    // Determine type
    let type: 'bug' | 'feature' | 'refactor' | 'docs' | 'unknown' = 'unknown';

    if (combined.includes('bug') || combined.includes('fix') || combined.includes('error')) {
      type = 'bug';
      keywords.push('bug', 'fix');
    }
    if (combined.includes('feature') || combined.includes('add') || combined.includes('implement')) {
      type = 'feature';
      keywords.push('feature', 'implementation');
    }
    if (combined.includes('refactor') || combined.includes('improve') || combined.includes('clean')) {
      type = 'refactor';
      keywords.push('refactor', 'improvement');
    }
    if (combined.includes('doc') || combined.includes('readme') || combined.includes('comment')) {
      type = 'docs';
      keywords.push('documentation');
    }

    // Determine complexity
    let complexity: 'low' | 'medium' | 'high' = 'low';

    if (combined.includes('complex') || combined.includes('architect') || combined.includes('migrate')) {
      complexity = 'high';
    } else if (combined.includes('update') || combined.includes('modify') || combined.includes('change')) {
      complexity = 'medium';
    }

    // Extract other keywords
    const patterns = [
      'security', 'performance', 'test', 'api', 'database', 'ui', 'auth',
      'validation', 'logging', 'config', 'dependency',
    ];

    for (const pattern of patterns) {
      if (combined.includes(pattern)) {
        keywords.push(pattern);
      }
    }

    return { type, complexity, keywords };
  }

  /**
   * Generates fix content based on analysis.
   */
  private generateFixContent(
    issue: Issue,
    analysis: ReturnType<typeof this.analyzeIssue>,
    approach?: string
  ): string {
    const lines: string[] = [];

    lines.push(`// Fix for: ${issue.title}`);
    lines.push(`// Issue ID: ${issue.id}`);
    lines.push(`// Type: ${analysis.type}`);
    lines.push(`// Complexity: ${analysis.complexity}`);
    lines.push('');

    if (approach) {
      lines.push(`// Approach: ${approach}`);
      lines.push('');
    }

    // Generate type-specific fix suggestions
    switch (analysis.type) {
      case 'bug':
        lines.push('// Bug fix suggestions:');
        lines.push('// 1. Identify the root cause of the bug');
        lines.push('// 2. Add/fix the problematic code');
        lines.push('// 3. Add tests to prevent regression');
        lines.push('// 4. Update documentation if needed');
        break;

      case 'feature':
        lines.push('// Feature implementation suggestions:');
        lines.push('// 1. Define the feature requirements');
        lines.push('// 2. Create/update necessary components');
        lines.push('// 3. Add unit and integration tests');
        lines.push('// 4. Update documentation');
        break;

      case 'refactor':
        lines.push('// Refactoring suggestions:');
        lines.push('// 1. Identify code smells');
        lines.push('// 2. Apply design patterns');
        lines.push('// 3. Ensure tests pass after refactoring');
        lines.push('// 4. Update comments and docs');
        break;

      case 'docs':
        lines.push('// Documentation suggestions:');
        lines.push('// 1. Add/update inline comments');
        lines.push('// 2. Update README if applicable');
        lines.push('// 3. Add JSDoc/TSDoc to public APIs');
        break;

      default:
        lines.push('// General suggestions:');
        lines.push('// 1. Analyze the issue requirements');
        lines.push('// 2. Plan the implementation');
        lines.push('// 3. Implement with tests');
    }

    // Add keyword-specific suggestions
    if (analysis.keywords.length > 0) {
      lines.push('');
      lines.push(`// Keywords: ${analysis.keywords.join(', ')}`);

      if (analysis.keywords.includes('security')) {
        lines.push('// Security: Ensure input validation and sanitization');
      }
      if (analysis.keywords.includes('performance')) {
        lines.push('// Performance: Consider caching and optimization');
      }
      if (analysis.keywords.includes('test')) {
        lines.push('// Testing: Add comprehensive test coverage');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generates a description of the fix.
   */
  private generateFixDescription(
    issue: Issue,
    analysis: ReturnType<typeof this.analyzeIssue>
  ): string {
    const typeDescriptions: Record<string, string> = {
      bug: 'Bug fix',
      feature: 'Feature implementation',
      refactor: 'Code refactoring',
      docs: 'Documentation update',
      unknown: 'General fix',
    };

    const base = typeDescriptions[analysis.type] ?? 'Fix';

    return `${base} for "${issue.title}" - ${analysis.complexity} complexity, keywords: ${analysis.keywords.join(', ') || 'none'}`;
  }

  /**
   * Identifies files that might be affected by the fix.
   */
  private identifyAffectedFiles(
    issue: Issue,
    analysis: ReturnType<typeof this.analyzeIssue>
  ): string[] {
    const files: string[] = [];

    if (issue.sourceFile) {
      files.push(issue.sourceFile);
    }

    // Suggest related files based on keywords
    if (analysis.keywords.includes('test')) {
      files.push('tests/ related files');
    }
    if (analysis.keywords.includes('api')) {
      files.push('api/ related files');
    }
    if (analysis.keywords.includes('database')) {
      files.push('db/ related files');
    }

    return files.length > 0 ? files : ['Unknown - manual analysis required'];
  }

  /**
   * Calculates confidence in the generated fix.
   */
  private calculateConfidence(
    issue: Issue,
    analysis: ReturnType<typeof this.analyzeIssue>
  ): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence for well-defined issues
    if (issue.title && issue.title.length > 10) {
      confidence += 0.1;
    }
    if (issue.description && issue.description.length > 20) {
      confidence += 0.15;
    }
    if (issue.sourceFile) {
      confidence += 0.1;
    }

    // Adjust based on complexity
    if (analysis.complexity === 'low') {
      confidence += 0.1;
    } else if (analysis.complexity === 'high') {
      confidence -= 0.15;
    }

    // Adjust based on type
    if (analysis.type === 'docs') {
      confidence += 0.1; // Docs are usually straightforward
    } else if (analysis.type === 'unknown') {
      confidence -= 0.1;
    }

    // Clamp to 0-1
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Checks if the expected outcome matches the current state.
   */
  private checkExpectedOutcome(issue: Issue, expectedOutcome: string): boolean {
    const expectedLower = expectedOutcome.toLowerCase();

    // Simple matching logic
    if (expectedLower.includes('resolved') && issue.status === 'done') {
      return true;
    }
    if (expectedLower.includes('progress') && issue.status === 'in_progress') {
      return true;
    }
    if (expectedLower.includes('description') && issue.description && issue.description.length > 0) {
      return true;
    }

    return false;
  }
}

/**
 * Creates a new FixerAgent instance.
 *
 * @param deps - Agent dependencies
 * @param config - Agent configuration
 * @returns Configured FixerAgent instance
 * @public
 */
export function createFixerAgent(deps: AgentDeps, config?: Partial<AgentConfig>): FixerAgent {
  return new FixerAgent(deps, { role: 'fixer', ...config });
}
