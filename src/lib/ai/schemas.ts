import { z } from "zod";

export const storiesSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().describe("Brief user journey flow (1-2 sentences) showing sequence of actions and outcome"),
    })
  ),
});

export const contentSchema = z.object({
  content: z.string().describe("Complete final content incorporating all context"),
});

export const phasesTasksSchema = z.object({
  phases: z.array(
    z.object({
      name: z.string().describe("Phase name (e.g., 'Foundation', 'Core Features')"),
      description: z.string().optional().describe("Brief description of the phase"),
      tasks: z.array(
        z.object({
          title: z.string().describe("Task title"),
          description: z.string().optional().describe("Detailed task description"),
          priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM").describe("Task priority level"),
          tempId: z.string().describe("Temporary ID for dependency mapping (e.g., 'T1', 'T2')"),
          dependsOn: z.array(z.string()).optional().describe("Array of tempIds this task depends on (e.g., ['T1', 'T2'])"),
          // Workflow-targeting fields (stakwork workspace only — mutually exclusive with repositoryId)
          workflowId: z.number().optional().describe("ID of an existing Stakwork workflow this task targets"),
          workflowName: z.string().optional().describe("Name of the target Stakwork workflow"),
          workflowRefId: z.string().optional().describe("Ref ID of the target Stakwork workflow"),
        })
      ),
    })
  ),
});

// Backwards compatibility alias
export const phasesTicketsSchema = phasesTasksSchema;
