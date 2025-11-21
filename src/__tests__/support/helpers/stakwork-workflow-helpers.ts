import { Response } from "node-fetch";

/**
 * Helper to create a mock Stakwork workflow API response
 */
export function createMockWorkflowResponse(
  transitions: Array<{ id: string; title: string; status: string; position?: { x: number; y: number } }>,
  connections: Array<{ source: string; target: string }>,
  workflowState: string,
): Response {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        transitions,
        connections,
        project: {
          workflow_state: workflowState,
        },
      },
    }),
    statusText: "OK",
  } as Response;
}

/**
 * Helper to create a simple mock workflow response with default data
 */
export function createDefaultMockWorkflowResponse(): Response {
  return createMockWorkflowResponse(
    [
      {
        id: "transition-1",
        title: "Step 1",
        position: { x: 100, y: 100 },
        status: "completed",
      },
    ],
    [
      {
        source: "transition-1",
        target: "transition-2",
      },
    ],
    "in_progress",
  );
}

/**
 * Helper to create an empty workflow response
 */
export function createEmptyWorkflowResponse(workflowState: string = "pending"): Response {
  return createMockWorkflowResponse([], [], workflowState);
}

/**
 * Helper to create a mock API error object that matches the BaseServiceClass error format
 */
export function createStakworkApiError(
  message: string,
  status: number,
  projectId: string,
  details?: Record<string, unknown>,
) {
  return {
    message,
    status,
    service: "stakwork",
    ...(details && { details }),
  };
}
