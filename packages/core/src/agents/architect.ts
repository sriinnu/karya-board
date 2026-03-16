/**
 * ArchitectAgent - Specialized agent for architectural analysis and planning.
 * Provides skills: analyze-structure, suggest-patterns, plan-migration
 * @packageDocumentation
 */

import { AgentBase } from './base.js';
import type { AgentDeps, AgentConfig, AgentContext } from './types.js';
import type {
  AnalyzeStructureParams,
  AnalyzeStructureResult,
  SuggestPatternsParams,
  SuggestPatternsResult,
  PlanMigrationParams,
  PlanMigrationResult,
} from './types.js';
import type { AgentCapability } from '../events/types.js';
import type { Issue } from '../db/models.js';

/**
 * ArchitectAgent provides structural analysis and architectural guidance.
 *
 * Capabilities:
 * - read: Can read issues and project data
 * - analyze-structure: Analyzes project structure and dependencies
 * - suggest-patterns: Suggests architectural patterns
 * - plan-migration: Plans migration strategies
 * - spawn-agents: Can spawn sub-agents for complex analysis
 *
 * @example
 * ```typescript
 * const architect = new ArchitectAgent(db, eventBus, { role: 'architect' });
 * await architect.initialize();
 *
 * const result = await architect.submitTask('analyze-structure', {
 *   projectId: 'proj-123',
 *   aspect: 'dependencies',
 * });
 * ```
 *
 * @public
 */
export class ArchitectAgent extends AgentBase {
  /**
   * Creates a new ArchitectAgent instance.
   *
   * @param deps - Agent dependencies
   * @param config - Agent configuration (role must be 'architect')
   */
  constructor(deps: AgentDeps, config: AgentConfig) {
    super(deps, { ...config, role: 'architect' });

    // Register skills
    this.registerSkill('analyze-structure', this.handleAnalyzeStructure.bind(this));
    this.registerSkill('suggest-patterns', this.handleSuggestPatterns.bind(this));
    this.registerSkill('plan-migration', this.handlePlanMigration.bind(this));
  }

  /**
   * Gets the capabilities of this agent.
   */
  protected getCapabilities(): AgentCapability[] {
    return [
      'read',
      'analyze-structure',
      'suggest-patterns',
      'plan-migration',
      'event-subscribe',
      'spawn-agents',
    ];
  }

  /**
   * Handles the analyze-structure skill.
   * Analyzes project structure based on issues and artifacts.
   */
  private async handleAnalyzeStructure(
    params: AnalyzeStructureParams,
    context: AgentContext
  ): Promise<AnalyzeStructureResult> {
    const project = context.db.getProjectById(params.projectId);
    if (!project) {
      return {
        summary: `Project not found: ${params.projectId}`,
        findings: ['Unable to analyze - project does not exist'],
      };
    }

    const issues = context.db.getIssuesByProject(params.projectId);
    const artifacts = context.db.getArtifactsByProject(params.projectId);
    const stats = context.db.getProjectStats(params.projectId);

    const findings: string[] = [];
    const metrics: Record<string, number | string> = {};
    const recommendations: string[] = [];

    // Gather metrics
    metrics.totalIssues = issues.length;
    metrics.openIssues = stats.open;
    metrics.inProgressIssues = stats.inProgress;
    metrics.doneIssues = stats.done;
    metrics.artifacts = artifacts.length;

    // Analyze aspect
    const aspect = params.aspect ?? 'all';

    if (aspect === 'dependencies' || aspect === 'all') {
      const depFindings = this.analyzeDependencies(issues, artifacts);
      findings.push(...depFindings.findings);
      recommendations.push(...depFindings.recommendations);
      Object.assign(metrics, depFindings.metrics);
    }

    if (aspect === 'patterns' || aspect === 'all') {
      const patternFindings = this.analyzePatterns(issues, artifacts);
      findings.push(...patternFindings.findings);
      recommendations.push(...patternFindings.recommendations);
    }

    if (aspect === 'complexity' || aspect === 'all') {
      const complexityFindings = this.analyzeComplexity(issues, stats);
      findings.push(...complexityFindings.findings);
      recommendations.push(...complexityFindings.recommendations);
      metrics.complexityScore = complexityFindings.complexityScore;
    }

    // Generate summary
    const summary = this.generateStructureSummary(project.name, stats, findings.length);

    return {
      summary,
      findings,
      metrics,
      recommendations: recommendations.length > 0 ? recommendations : undefined,
    };
  }

  /**
   * Handles the suggest-patterns skill.
   * Suggests architectural patterns based on project analysis.
   */
  private async handleSuggestPatterns(
    params: SuggestPatternsParams,
    context: AgentContext
  ): Promise<SuggestPatternsResult> {
    const project = context.db.getProjectById(params.projectId);
    if (!project) {
      return { patterns: [] };
    }

    const issues = context.db.getIssuesByProject(params.projectId);
    const artifacts = context.db.getArtifactsByProject(params.projectId);
    const patternType = params.patternType ?? 'all';

    const patterns: SuggestPatternsResult['patterns'] = [];

    // Analyze issues for pattern opportunities
    if (patternType === 'architectural' || patternType === 'all') {
      patterns.push(...this.suggestArchitecturalPatterns(issues, artifacts));
    }

    if (patternType === 'code' || patternType === 'all') {
      patterns.push(...this.suggestCodePatterns(issues));
    }

    if (patternType === 'testing' || patternType === 'all') {
      patterns.push(...this.suggestTestingPatterns(issues));
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    patterns.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return { patterns };
  }

  /**
   * Handles the plan-migration skill.
   * Creates a migration plan for a project.
   */
  private async handlePlanMigration(
    params: PlanMigrationParams,
    context: AgentContext
  ): Promise<PlanMigrationResult> {
    const project = context.db.getProjectById(params.projectId);
    if (!project) {
      return {
        steps: [{
          order: 1,
          description: 'Project not found - cannot plan migration',
          estimatedEffort: 'low',
        }],
        risk: 'high',
        estimatedEffort: 'Unknown',
      };
    }

    const issues = context.db.getIssuesByProject(params.projectId);
    const artifacts = context.db.getArtifactsByProject(params.projectId);

    // Generate migration steps
    const steps = this.generateMigrationSteps(params.target, issues, artifacts, params.components);

    // Assess risk
    const risk = this.assessMigrationRisk(issues, artifacts, steps);

    // Estimate effort
    const estimatedEffort = this.estimateMigrationEffort(steps, risk);

    return { steps, risk, estimatedEffort };
  }

  /**
   * Analyzes dependencies based on issues and artifacts.
   */
  private analyzeDependencies(
    issues: Issue[],
    artifacts: Array<{ filePath: string; content: string | null }>
  ): { findings: string[]; recommendations: string[]; metrics: Record<string, number> } {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const metrics: Record<string, number> = {};

    // Count issue sources
    const sourceFiles = new Set<string>();
    issues.forEach((issue) => {
      if (issue.sourceFile) {
        sourceFiles.add(issue.sourceFile);
      }
    });

    metrics.filesWithIssues = sourceFiles.size;
    metrics.totalArtifacts = artifacts.length;

    // Check for high coupling indicators
    const fileIssueCounts = new Map<string, number>();
    issues.forEach((issue) => {
      if (issue.sourceFile) {
        fileIssueCounts.set(issue.sourceFile, (fileIssueCounts.get(issue.sourceFile) ?? 0) + 1);
      }
    });

    const highCouplingFiles = Array.from(fileIssueCounts.entries())
      .filter(([, count]) => count >= 5);

    if (highCouplingFiles.length > 0) {
      findings.push(`Found ${highCouplingFiles.length} file(s) with high issue density (5+ issues)`);
      recommendations.push('Consider refactoring high-coupling files to reduce complexity');
    }

    // Check for scanner coverage
    const scannerIssues = issues.filter((i) => i.source === 'scanner');
    metrics.scannerIssueRatio = issues.length > 0 ? scannerIssues.length / issues.length : 0;

    if (metrics.scannerIssueRatio < 0.5) {
      recommendations.push('Consider expanding scanner coverage to find more TODOs automatically');
    }

    return { findings, recommendations, metrics };
  }

  /**
   * Analyzes patterns in issues and artifacts.
   */
  private analyzePatterns(
    issues: Issue[],
    _artifacts: Array<{ filePath: string }>
  ): { findings: string[]; recommendations: string[] } {
    const findings: string[] = [];
    const recommendations: string[] = [];

    // Analyze issue patterns
    const titles = issues.map((i) => i.title.toLowerCase());

    // Check for common issue patterns
    const bugCount = titles.filter((t) => t.includes('bug') || t.includes('fix')).length;
    const featureCount = titles.filter((t) => t.includes('feature') || t.includes('add')).length;
    const refactorCount = titles.filter((t) => t.includes('refactor') || t.includes('improve')).length;

    if (bugCount > featureCount) {
      findings.push('More bugs than features being tracked - consider quality initiatives');
      recommendations.push('Implement more robust testing strategy');
    }

    if (refactorCount > issues.length * 0.3) {
      findings.push('High ratio of refactoring tasks - indicates technical debt');
      recommendations.push('Prioritize refactoring to reduce accumulated debt');
    }

    return { findings, recommendations };
  }

  /**
   * Analyzes complexity based on issues.
   */
  private analyzeComplexity(
    _issues: Issue[],
    stats: { critical: number; high: number; open: number }
  ): { findings: string[]; recommendations: string[]; complexityScore: number } {
    const findings: string[] = [];
    const recommendations: string[] = [];

    // Calculate complexity score (0-100)
    let complexityScore = 0;

    // Factor: critical/high issues
    complexityScore += stats.critical * 10;
    complexityScore += stats.high * 5;

    // Factor: open issue ratio
    if (stats.open > 20) {
      complexityScore += 15;
      findings.push('High number of open issues');
    }

    // Cap at 100
    complexityScore = Math.min(complexityScore, 100);

    if (complexityScore > 70) {
      recommendations.push('Project has high complexity - consider breaking down into smaller components');
    } else if (complexityScore > 40) {
      recommendations.push('Moderate complexity - monitor for increasing technical debt');
    }

    return { findings, recommendations, complexityScore };
  }

  /**
   * Generates a summary of structure analysis.
   */
  private generateStructureSummary(
    projectName: string,
    stats: { total: number; open: number; done: number },
    findingCount: number
  ): string {
    return `Analysis of "${projectName}": ${stats.total} issues (${stats.open} open, ${stats.done} done), ${findingCount} findings`;
  }

  /**
   * Suggests architectural patterns.
   */
  private suggestArchitecturalPatterns(
    issues: Issue[],
    _artifacts: Array<{ filePath: string }>
  ): SuggestPatternsResult['patterns'] {
    const patterns: SuggestPatternsResult['patterns'] = [];

    // Analyze for pattern opportunities
    const hasComplexityIssues = issues.some((i) =>
      i.title.toLowerCase().includes('complex') ||
      i.title.toLowerCase().includes('refactor')
    );

    if (hasComplexityIssues) {
      patterns.push({
        name: 'Modular Architecture',
        description: 'Break down complex components into smaller, focused modules',
        applicability: 'High - complexity issues detected',
        priority: 'high',
      });
    }

    const hasTestingIssues = issues.some((i) =>
      i.title.toLowerCase().includes('test') ||
      i.title.toLowerCase().includes('coverage')
    );

    if (hasTestingIssues) {
      patterns.push({
        name: 'Test-Driven Development',
        description: 'Adopt TDD practices to improve code quality',
        applicability: 'High - testing-related issues detected',
        priority: 'high',
      });
    }

    // Always suggest some patterns
    patterns.push({
      name: 'Repository Pattern',
      description: 'Abstract data access logic for better separation of concerns',
      applicability: 'Medium - useful for database operations',
      priority: 'medium',
    });

    return patterns;
  }

  /**
   * Suggests code patterns.
   */
  private suggestCodePatterns(issues: Issue[]): SuggestPatternsResult['patterns'] {
    const patterns: SuggestPatternsResult['patterns'] = [];

    const hasErrorHandlingIssues = issues.some((i) =>
      i.title.toLowerCase().includes('error') ||
      i.title.toLowerCase().includes('exception')
    );

    if (hasErrorHandlingIssues) {
      patterns.push({
        name: 'Result Type Pattern',
        description: 'Use explicit result types instead of exceptions for error handling',
        applicability: 'High - error handling issues detected',
        priority: 'high',
      });
    }

    patterns.push({
      name: 'Factory Pattern',
      description: 'Use factories for complex object creation',
      applicability: 'Medium - improves testability',
      priority: 'low',
    });

    return patterns;
  }

  /**
   * Suggests testing patterns.
   */
  private suggestTestingPatterns(issues: Issue[]): SuggestPatternsResult['patterns'] {
    const patterns: SuggestPatternsResult['patterns'] = [];

    const hasIntegrationIssues = issues.some((i) =>
      i.title.toLowerCase().includes('integration')
    );

    if (hasIntegrationIssues) {
      patterns.push({
        name: 'Integration Test Patterns',
        description: 'Implement proper integration tests with test containers or mocks',
        applicability: 'High - integration issues detected',
        priority: 'high',
      });
    }

    patterns.push({
      name: 'Arrange-Act-Assert',
      description: 'Structure tests clearly with AAA pattern',
      applicability: 'Always applicable',
      priority: 'medium',
    });

    return patterns;
  }

  /**
   * Generates migration steps.
   */
  private generateMigrationSteps(
    target: string,
    issues: Issue[],
    _artifacts: Array<{ filePath: string }>,
    components?: string[]
  ): PlanMigrationResult['steps'] {
    const steps: PlanMigrationResult['steps'] = [];

    // Standard migration steps
    steps.push({
      order: 1,
      description: `Analyze current codebase for ${target} compatibility`,
      estimatedEffort: 'medium',
    });

    steps.push({
      order: 2,
      description: 'Create migration branch and backup',
      estimatedEffort: 'low',
      dependencies: ['step-1'],
    });

    steps.push({
      order: 3,
      description: `Update dependencies to ${target}-compatible versions`,
      estimatedEffort: 'high',
      dependencies: ['step-2'],
    });

    if (components && components.length > 0) {
      components.forEach((component, index) => {
        steps.push({
          order: 4 + index,
          description: `Migrate component: ${component}`,
          estimatedEffort: 'medium',
          dependencies: ['step-3'],
        });
      });
    } else {
      steps.push({
        order: 4,
        description: 'Migrate core components',
        estimatedEffort: 'high',
        dependencies: ['step-3'],
      });
    }

    // Check for blockers
    const blockers = issues.filter((i) =>
      i.title.toLowerCase().includes('blocker') ||
      i.priority === 'critical'
    );

    if (blockers.length > 0) {
      steps.push({
        order: steps.length + 1,
        description: 'Resolve blocking issues before continuing migration',
        estimatedEffort: 'high',
      });
    }

    steps.push({
      order: steps.length + 1,
      description: 'Run full test suite and fix failures',
      estimatedEffort: 'high',
    });

    steps.push({
      order: steps.length + 1,
      description: 'Update documentation',
      estimatedEffort: 'low',
    });

    return steps;
  }

  /**
   * Assesses migration risk.
   */
  private assessMigrationRisk(
    issues: Issue[],
    _artifacts: Array<{ filePath: string }>,
    steps: PlanMigrationResult['steps']
  ): PlanMigrationResult['risk'] {
    // Count high-effort steps
    const highEffortSteps = steps.filter((s) => s.estimatedEffort === 'high').length;

    // Count critical/high priority issues
    const urgentIssues = issues.filter((i) =>
      i.priority === 'critical' || i.priority === 'high'
    ).length;

    if (highEffortSteps > 3 || urgentIssues > 5) {
      return 'high';
    } else if (highEffortSteps > 1 || urgentIssues > 2) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Estimates migration effort.
   */
  private estimateMigrationEffort(
    steps: PlanMigrationResult['steps'],
    risk: PlanMigrationResult['risk']
  ): string {
    const stepCount = steps.length;
    const effortMap = {
      low: 1,
      medium: 2,
      high: 3,
    };

    const totalEffort = steps.reduce((sum, step) => {
      return sum + effortMap[step.estimatedEffort];
    }, 0);

    const riskMultiplier = risk === 'high' ? 1.5 : risk === 'medium' ? 1.2 : 1;
    const adjustedEffort = Math.round(totalEffort * riskMultiplier);

    if (adjustedEffort > 20 || stepCount > 10) {
      return '2-4 weeks';
    } else if (adjustedEffort > 10 || stepCount > 5) {
      return '1-2 weeks';
    } else {
      return '1-5 days';
    }
  }
}

/**
 * Creates a new ArchitectAgent instance.
 *
 * @param deps - Agent dependencies
 * @param config - Agent configuration
 * @returns Configured ArchitectAgent instance
 * @public
 */
export function createArchitectAgent(deps: AgentDeps, config?: Partial<AgentConfig>): ArchitectAgent {
  return new ArchitectAgent(deps, { role: 'architect', ...config });
}
