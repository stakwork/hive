export const MOCK_MESSAGES = [
  {
    id: "1",
    role: "user" as const,
    content: "What services does the authentication module depend on?",
    timestamp: new Date(),
  },
  {
    id: "2",
    role: "assistant" as const,
    content:
      "The authentication module depends on **3 core services**: `UserService`, `TokenService`, and `SessionStore`. It also has indirect dependencies on `EmailService` for password resets and `AuditLogger` for security events.\n\nI've highlighted the relevant nodes in the graph above.",
    timestamp: new Date(),
  },
  {
    id: "3",
    role: "user" as const,
    content: "Which functions have no test coverage?",
    timestamp: new Date(),
  },
  {
    id: "4",
    role: "assistant" as const,
    content:
      "Found **12 uncovered functions** across 4 files. The most critical ones are in `auth/token.ts` (3 functions) and `payments/refund.ts` (2 functions). The test layer is now highlighted in the graph.",
    timestamp: new Date(),
  },
];

export const MOCK_FOLLOW_UPS = [
  "Show me the call graph for TokenService",
  "Which endpoints are untested?",
  "Find circular dependencies",
];

// Widgets: kept identical to production layout — top-left ingestion, top-right status row, bottom-left members
export const WIDGET_DATA = {
  github: { connected: true, repo: "stakwork/hive", branch: "main", prs: 3 },
  pool: { status: "ACTIVE", pods: 2, health: 98 },
  coverage: { unit: 74, integration: 61, e2e: 42 },
  members: [
    { initials: "JD", color: "#7c6af7" },
    { initials: "AK", color: "#3b82f6" },
    { initials: "ML", color: "#10b981" },
  ],
  needsInput: 2,
};
