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
  // Numeric-workflow-id entries for the inspector tab (dev UX):
  // workflow_id "12345" maps to a real inspectable workflow; the inspector
  // passes the parsed numeric id as a string so these keys match.
  {
    id: "mock-mso-4",
    workflow_id: "12345",
    step_id: "step-fetch-users",
    workflow_version_id: null, // global — visible regardless of selected version
    output: { users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }], total: 2 },
    created_at: "2024-04-01T08:00:00Z",
    updated_at: "2024-04-10T09:00:00Z",
  },
  {
    id: "mock-mso-5",
    workflow_id: "12345",
    step_id: "step-process-data",
    workflow_version_id: "67890", // version-specific — visible only when version 67890 is selected
    output: { processed: true, records: 42, status: "ok" },
    created_at: "2024-04-02T10:00:00Z",
    updated_at: "2024-04-12T11:30:00Z",
  },
];

export function makeUpsertKey(
  workflow_id: string,
  step_id: string,
  workflow_version_id: string | null | undefined
): string {
  return `${workflow_id}::${step_id}::${workflow_version_id ?? "null"}`;
}
