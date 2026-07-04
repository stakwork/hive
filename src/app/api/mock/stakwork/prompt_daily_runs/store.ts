export interface MockPromptDailyRunEntry {
  id: number;
  prompt_id: number;
  prompt_version_id: number;
  workflow_id: number;
  customer_id: number;
  run_date: string; // YYYY-MM-DD
  run_count: number;
  hive_version_id: string;
  created_at: string;
  updated_at: string;
}

// In-memory store — all rows must have hive_version_id set.
// Seeded with sample rows: some matching known PromptVersion ids, one unresolvable.
export const mockPromptDailyRunsStore: MockPromptDailyRunEntry[] = [
  {
    id: 1,
    prompt_id: 1,
    prompt_version_id: 10,
    workflow_id: 101,
    customer_id: 1001,
    run_date: "2024-01-15",
    run_count: 42,
    hive_version_id: "mock-version-id-1",
    created_at: "2024-01-16T02:00:00Z",
    updated_at: "2024-01-16T02:00:00Z",
  },
  {
    id: 2,
    prompt_id: 2,
    prompt_version_id: 20,
    workflow_id: 201,
    customer_id: 1001,
    run_date: "2024-01-15",
    run_count: 17,
    hive_version_id: "mock-version-id-2",
    created_at: "2024-01-16T02:00:00Z",
    updated_at: "2024-01-16T02:00:00Z",
  },
  {
    // Unresolvable hive_version_id — for negative-path testing
    id: 3,
    prompt_id: 99,
    prompt_version_id: 990,
    workflow_id: 999,
    customer_id: 9999,
    run_date: "2024-01-15",
    run_count: 5,
    hive_version_id: "unresolvable-version-id",
    created_at: "2024-01-16T02:00:00Z",
    updated_at: "2024-01-16T02:00:00Z",
  },
  {
    id: 4,
    prompt_id: 1,
    prompt_version_id: 10,
    workflow_id: 101,
    customer_id: 1001,
    run_date: "2024-01-16",
    run_count: 55,
    hive_version_id: "mock-version-id-1",
    created_at: "2024-01-17T02:00:00Z",
    updated_at: "2024-01-17T02:00:00Z",
  },
];
