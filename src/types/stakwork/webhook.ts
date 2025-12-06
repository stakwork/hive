import { z } from "zod";

export const StakworkRunWebhookSchema = z.object({
  project_id: z.string(),
  status: z.string(),
  result: z.any().optional(),
  workspaceId: z.string().optional(),
  taskId: z.string().optional(),
  transitions: z.array(z.object({
    log: z.string().optional(),
    output: z.string().optional(),
    step_state: z.string().optional(),
    step_id: z.string().optional(),
    step_name: z.string().optional(),
  })).optional(),
});

export type StakworkRunWebhookPayload = z.infer<typeof StakworkRunWebhookSchema>;
