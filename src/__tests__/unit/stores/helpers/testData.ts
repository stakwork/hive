/**
 * Test data constants for useInsightsStore tests
 */

export const TEST_RECOMMENDATION_IDS = {
  SIMPLE: "rec-123",
  FIRST: "rec-1",
  SECOND: "rec-2",
  THIRD: "rec-3",
  FOURTH: "rec-4",
  EMPTY: "",
  LONG: "a".repeat(1000),
  SPECIAL_CHARS: "rec-123-abc_def@456",
  UUID: "550e8400-e29b-41d4-a716-446655440000",
};

export const createMockSuccessResponse = (recommendationId: string) => ({
  success: true,
  task: { id: "task-1", title: "Test Task" },
  recommendation: { id: recommendationId, status: "ACCEPTED" },
});

export const createMinimalSuccessResponse = () => ({
  success: true,
});

export const createCompleteTaskResponse = (recommendationId: string) => ({
  success: true,
  task: {
    id: "task-1",
    title: "Implement unit tests",
    description: "Add test coverage",
    status: "TODO",
    priority: "HIGH",
  },
  recommendation: {
    id: recommendationId,
    status: "ACCEPTED",
    acceptedAt: "2024-01-01T00:00:00.000Z",
  },
});

export const createResponseWithMetadata = (recommendationId: string) => ({
  success: true,
  task: { id: "task-1" },
  recommendation: { id: recommendationId },
  metadata: {
    processingTime: 150,
    aiModel: "gpt-4",
    confidence: 0.95,
  },
});

export const ERROR_MESSAGES = {
  NOT_FOUND: "Recommendation not found",
  UNAUTHORIZED: "Unauthorized",
  INSUFFICIENT_PERMISSIONS: "Insufficient permissions to accept recommendations",
  ALREADY_PROCESSED: "Recommendation has already been processed",
  ASSIGNEE_NOT_MEMBER: "Assignee is not a member of this workspace",
  REPOSITORY_NOT_FOUND: "Repository not found in this workspace",
  NETWORK_FAILURE: "Network failure",
  GENERIC_FAILURE: "Failed",
};
