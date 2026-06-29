export interface MockPromptEntry {
  id: number;
  name: string;
  value: string;
  description: string;
  usage_notation?: string;
  run_count?: number;
  current_version_id: number;
  published_version_id?: number | null;
  created_at: string;
  updated_at: string;
  hive_version_id?: string | null;
}

// In-memory store – keyed by numeric id.
// Shared between route.ts and [id]/route.ts.
export const mockPromptsStore: Map<number, MockPromptEntry> = new Map([
  [
    1,
    {
      id: 1,
      name: "SYSTEM_PROMPT_V1",
      value: "You are a helpful AI assistant. Always be polite and professional.",
      description: "Basic system prompt for general assistance",
      usage_notation: null as unknown as undefined,
      run_count: 0,
      current_version_id: 3,
      published_version_id: 3,
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-02-20T15:30:00Z",
    },
  ],
  [
    2,
    {
      id: 2,
      name: "CODE_REVIEW_PROMPT",
      value:
        "Review this code for:\n- Bugs\n- Performance issues\n- Security vulnerabilities\n- Best practices\n\nProvide detailed feedback.",
      description: "Prompt for AI code review tasks",
      run_count: 42,
      current_version_id: 5,
      published_version_id: 5,
      created_at: "2024-02-01T09:00:00Z",
      updated_at: "2024-02-25T11:20:00Z",
    },
  ],
  [
    3,
    {
      id: 3,
      name: "API_DOCUMENTATION_WRITER",
      value:
        "Create comprehensive API documentation for:\n\nEndpoint: {endpoint}\nMethod: {method}\nDescription: {description}\n\nInclude request/response examples and error cases.",
      description: "Generates clear API documentation with examples",
      run_count: 7,
      current_version_id: 2,
      published_version_id: 2,
      created_at: "2024-02-01T11:00:00Z",
      updated_at: "2024-02-27T10:00:00Z",
    },
  ],
]);
