export interface MockStepOutput {
  id: string;
  workflow_id: string;
  step_id: string;
  workflow_version_id: string | null;
  output: unknown;
  created_at: string;
  updated_at: string;
}

// In-memory store for dev-mode mock data — shared between the list route and
// the by-id child route via module caching (single instance per server process).
export const mockStore: MockStepOutput[] = [
  {
    id: "mock-mso-1",
    workflow_id: "workflow-123",
    step_id: "step-fetch-data",
    workflow_version_id: null,
    output: { status: "success", records: [{ id: 1, name: "Alice" }] },
    created_at: "2024-01-10T08:00:00Z",
    updated_at: "2024-03-05T11:00:00Z",
  },
  {
    id: "mock-mso-2",
    workflow_id: "workflow-123",
    step_id: "step-transform",
    workflow_version_id: "version-42",
    output: { transformed: true, count: 5 },
    created_at: "2024-02-01T09:00:00Z",
    updated_at: "2024-02-15T14:30:00Z",
  },
  {
    id: "mock-mso-3",
    workflow_id: "workflow-456",
    step_id: "step-notify",
    workflow_version_id: null,
    output: false,
    created_at: "2024-03-01T10:00:00Z",
    updated_at: "2024-03-01T10:00:00Z",
  },
];

export function makeUpsertKey(
  workflow_id: string,
  step_id: string,
  workflow_version_id: string | null | undefined
): string {
  return `${workflow_id}::${step_id}::${workflow_version_id ?? "null"}`;
}
