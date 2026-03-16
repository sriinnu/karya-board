/**
 * MCP tool for invoking agent skills.
 * Allows MCP clients to leverage specialized agents for tasks.
 * @packageDocumentation
 */

import type {
  AgentRegistry,
  AgentRole,
  AgentSkill,
  TaskParams,
  TaskResult,
} from '@karya/core';

/**
 * Parameters for the invoke_agent tool.
 * @public
 */
export interface InvokeAgentParams {
  /** Agent role to use */
  role: AgentRole;
  /** Skill to invoke */
  skill: AgentSkill;
  /** Parameters for the skill */
  params: TaskParams;
  /** Wait for completion (default: true) */
  waitForCompletion?: boolean;
}

/**
 * Result of the invoke_agent tool.
 * @public
 */
export interface InvokeAgentResult<TResult extends TaskResult = TaskResult> {
  /** Whether the invocation was successful */
  success: boolean;
  /** Task ID for tracking */
  taskId?: string;
  /** Task status */
  status?: 'pending' | 'running' | 'completed' | 'failed';
  /** Task result when completed */
  result?: TResult;
  /** Error message if failed */
  error?: string;
}

/**
 * Parameters for the get_agent_info tool.
 * @public
 */
export interface GetAgentInfoParams {
  /** Optional role to filter by */
  role?: AgentRole;
}

/**
 * Result of the get_agent_info tool.
 * @public
 */
export interface GetAgentInfoResult {
  /** Whether the query was successful */
  success: boolean;
  /** Agent information */
  agents?: Array<{
    id: string;
    role: AgentRole;
    capabilities: string[];
    active: boolean;
    currentTasks: number;
    tasksCompleted: number;
    tasksFailed: number;
    supportedSkills: AgentSkill[];
  }>;
  /** System statistics */
  stats?: {
    totalAgents: number;
    activeAgents: number;
    totalTasksCompleted: number;
    totalTasksFailed: number;
    agentsByRole: Record<AgentRole, number>;
  };
  /** Error message if failed */
  error?: string;
}

/**
 * Skill descriptions for documentation.
 * @internal
 */
const SKILL_DESCRIPTIONS: Record<AgentRole, Record<string, string>> = {
  reviewer: {
    'review-issue': 'Reviews an issue for quality, completeness, and actionability',
    'suggest-priority': 'Suggests an appropriate priority level for an issue',
    'validate-issue': 'Validates issue completeness against quality rules',
  },
  architect: {
    'analyze-structure': 'Analyzes project structure for patterns and issues',
    'suggest-patterns': 'Suggests architectural patterns for improvement',
    'plan-migration': 'Plans a migration strategy for technology upgrades',
  },
  fixer: {
    'generate-fix': 'Generates a fix suggestion for an issue',
    'apply-fix': 'Applies a fix to an issue (with verification)',
    'verify-fix': 'Verifies that a fix has been properly applied',
  },
  triager: {
    'categorize-issue': 'Categorizes an issue into appropriate categories',
    'assign-priority': 'Assigns a priority level to an issue',
    'route-issue': 'Routes an issue to the appropriate team or component',
  },
};

/**
 * Creates the invoke_agent MCP tool.
 *
 * @param agentRegistry - AgentRegistry instance
 * @returns Tool handler function
 * @public
 */
export function createInvokeAgentTool(agentRegistry: AgentRegistry) {
  return async <TResult extends TaskResult = TaskResult>(
    params: InvokeAgentParams
  ): Promise<InvokeAgentResult<TResult>> => {
    try {
      if (!params.role || !params.skill) {
        return {
          success: false,
          error: 'Both role and skill are required',
        };
      }

      // Find an agent with the required skill
      const agent = agentRegistry.findAgentWithSkill(params.skill);
      if (!agent) {
        return {
          success: false,
          error: `No agent available with skill: ${params.skill}`,
        };
      }

      // Verify the agent has the expected role
      if (agent.role !== params.role) {
        // Try to find an agent with both the role and skill
        const roleAgents = agentRegistry.getAgentsByRole(params.role);
        const matchingAgent = roleAgents.find((a) =>
          a.supportedSkills.includes(params.skill)
        );

        if (!matchingAgent) {
          return {
            success: false,
            error: `No agent with role '${params.role}' has skill: ${params.skill}`,
          };
        }
      }

      // Submit the task
      const waitForCompletion = params.waitForCompletion ?? true;

      if (waitForCompletion) {
        // Use the registry's submitTask method which handles waiting
        const task = await agentRegistry.submitTask(params.skill, params.params);

        return {
          success: task.status === 'completed',
          taskId: task.id,
          status: task.status,
          result: task.result as TResult | undefined,
          error: task.error?.message,
        };
      } else {
        // Submit without waiting
        const task = await agent.submitTask(params.skill, params.params);

        return {
          success: true,
          taskId: task.id,
          status: task.status,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Creates the get_agent_info MCP tool.
 *
 * @param agentRegistry - AgentRegistry instance
 * @returns Tool handler function
 * @public
 */
export function createGetAgentInfoTool(agentRegistry: AgentRegistry) {
  return async (params: GetAgentInfoParams = {}): Promise<GetAgentInfoResult> => {
    try {
      const stats = agentRegistry.getStats();
      let agents = agentRegistry.getAllAgentInfo();

      // Filter by role if specified
      if (params.role) {
        agents = agents.filter((a) => a.role === params.role);
      }

      // Get supported skills for each agent
      const agentsWithSkills = agents.map((agent) => {
        const skills = Object.keys(SKILL_DESCRIPTIONS[agent.role] ?? {});
        return {
          ...agent,
          capabilities: Array.from(agent.capabilities),
          supportedSkills: skills as AgentSkill[],
        };
      });

      return {
        success: true,
        agents: agentsWithSkills,
        stats,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Input schema for the invoke_agent tool.
 * @public
 */
export const INVOKE_AGENT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    role: {
      type: 'string',
      enum: ['reviewer', 'architect', 'fixer', 'triager'],
      description: 'Agent role to use for the task',
    },
    skill: {
      type: 'string',
      description:
        'Skill to invoke. Available skills depend on the role:\n' +
        '- reviewer: review-issue, suggest-priority, validate-issue\n' +
        '- architect: analyze-structure, suggest-patterns, plan-migration\n' +
        '- fixer: generate-fix, apply-fix, verify-fix\n' +
        '- triager: categorize-issue, assign-priority, route-issue',
    },
    params: {
      type: 'object',
      description: 'Parameters for the skill. Common parameters:\n' +
        '- issueId: ID of the issue to work with\n' +
        '- projectId: ID of the project to analyze\n' +
        '- context: Additional context for the task',
    },
    waitForCompletion: {
      type: 'boolean',
      description: 'Whether to wait for the task to complete (default: true)',
    },
  },
  required: ['role', 'skill', 'params'],
} as const;

/**
 * Input schema for the get_agent_info tool.
 * @public
 */
export const GET_AGENT_INFO_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    role: {
      type: 'string',
      enum: ['reviewer', 'architect', 'fixer', 'triager'],
      description: 'Optional role to filter agents by',
    },
  },
} as const;

/**
 * Gets skill descriptions for documentation.
 * @internal
 */
export function getSkillDescriptions(): Record<AgentRole, Record<string, string>> {
  return { ...SKILL_DESCRIPTIONS };
}
