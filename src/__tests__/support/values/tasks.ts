/**
 * Task data pools - edit THIS file when Task schema changes
 *
 * Structure:
 * - Named entries: Specific tasks for deterministic scenarios
 * - Pools: Arrays for generating varied data by category
 */

export const TASK_VALUES = {
  // Named entries for specific scenarios
  loginFeature: {
    title: "Implement user login flow",
    description: "Add authentication with email/password and OAuth providers",
    status: "TODO" as const,
    priority: "HIGH" as const,
    sourceType: "USER" as const,
  },
  dashboardBug: {
    title: "Fix dashboard loading spinner",
    description: "Spinner continues after data loads on slow connections",
    status: "IN_PROGRESS" as const,
    priority: "MEDIUM" as const,
    sourceType: "USER" as const,
  },
  apiRefactor: {
    title: "Refactor API error handling",
    description: "Standardize error responses across all endpoints",
    status: "DONE" as const,
    priority: "MEDIUM" as const,
    sourceType: "USER" as const,
  },
  securityAudit: {
    title: "Security vulnerability scan",
    description: "Run automated security audit on dependencies",
    status: "TODO" as const,
    priority: "CRITICAL" as const,
    sourceType: "JANITOR" as const,
  },
  testCoverage: {
    title: "Increase test coverage to 80%",
    description: "Add unit tests for authentication module",
    status: "TODO" as const,
    priority: "MEDIUM" as const,
    sourceType: "JANITOR" as const,
  },
} as const;

// Pools for generating varied data
export const TASK_POOLS = {
  titles: {
    bug: [
      "Fix login timeout on slow connections",
      "Resolve memory leak in dashboard",
      "Handle null pointer in user service",
      "Fix race condition in payment processing",
      "Resolve infinite loop in notification system",
      "Fix broken pagination on mobile",
      "Handle edge case in date formatting",
      "Fix CSS overflow in sidebar",
      "Resolve session expiry not triggering logout",
      "Fix duplicate API calls on refresh",
    ],
    feature: [
      "Add dark mode toggle",
      "Implement SSO with SAML",
      "Build export to CSV feature",
      "Add real-time collaboration",
      "Implement webhook integrations",
      "Add bulk import functionality",
      "Create custom dashboard widgets",
      "Implement role-based permissions",
      "Add email notification preferences",
      "Build API rate limiting",
    ],
    chore: [
      "Update dependencies to latest",
      "Migrate to Node 20",
      "Add monitoring dashboards",
      "Refactor database queries",
      "Clean up unused imports",
      "Update README documentation",
      "Configure CI/CD pipeline",
      "Set up staging environment",
      "Archive old feature branches",
      "Update API documentation",
    ],
    janitor: [
      "Improve test coverage for auth module",
      "Add missing TypeScript types",
      "Fix ESLint warnings in components",
      "Remove deprecated API calls",
      "Add input validation to forms",
      "Implement error boundaries",
      "Add logging to critical paths",
      "Review and update security headers",
      "Optimize database indexes",
      "Add retry logic to API calls",
    ],
  },
  descriptions: {
    bug: [
      "Users report intermittent failures when attempting to complete this action.",
      "Memory usage grows over time causing performance degradation.",
      "The application crashes under specific conditions that need investigation.",
      "This issue affects a subset of users and requires immediate attention.",
      "Logs show errors occurring during peak traffic hours.",
    ],
    feature: [
      "As a user, I want to have this capability to improve my workflow.",
      "This feature will enable teams to collaborate more effectively.",
      "Requested by multiple customers in recent feedback sessions.",
      "This will reduce manual work and improve efficiency.",
      "Implementing this will align us with industry standards.",
    ],
    chore: [
      "Technical debt that has been accumulating over several sprints.",
      "This will improve developer experience and code maintainability.",
      "Required for compliance with updated security standards.",
      "Will help reduce build times and improve CI performance.",
      "Preparation for upcoming major feature development.",
    ],
    janitor: [
      "Automated analysis detected this improvement opportunity.",
      "This will improve code quality and reduce future bugs.",
      "Recommended by static analysis tools.",
      "Will make the codebase more maintainable long-term.",
      "Addresses technical debt identified in recent review.",
    ],
  },
  statuses: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED", "BLOCKED"] as const,
  priorities: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const,
  sourceTypes: ["USER", "JANITOR", "SYSTEM", "USER_JOURNEY"] as const,
  workflowStatuses: ["PENDING", "IN_PROGRESS", "COMPLETED", "ERROR", "FAILED", "HALTED"] as const,
} as const;

// Counters for unique generation
let taskCounter = 0;
const usedTitles = new Set<string>();

/**
 * Get a random task from the pools with unique title
 */
export function getRandomTask(category: "bug" | "feature" | "chore" | "janitor" = "feature") {
  const titles = TASK_POOLS.titles[category];
  const descriptions = TASK_POOLS.descriptions[category];

  // Find an unused title, or generate a unique one
  let title = titles[Math.floor(Math.random() * titles.length)];
  if (usedTitles.has(title)) {
    const uniqueSuffix = ++taskCounter;
    title = `${title} (#${uniqueSuffix})`;
  }
  usedTitles.add(title);

  const description = descriptions[Math.floor(Math.random() * descriptions.length)];
  const status = TASK_POOLS.statuses[Math.floor(Math.random() * 3)]; // Bias toward TODO, IN_PROGRESS, DONE
  const priority = TASK_POOLS.priorities[Math.floor(Math.random() * TASK_POOLS.priorities.length)];
  const sourceType = category === "janitor" ? "JANITOR" : "USER";

  return {
    title,
    description,
    status,
    priority,
    sourceType: sourceType as typeof TASK_POOLS.sourceTypes[number],
  };
}

/**
 * Get a named task value by key
 */
export function getNamedTask(key: keyof typeof TASK_VALUES) {
  return { ...TASK_VALUES[key] };
}

/**
 * Reset task counters (useful for test isolation)
 */
export function resetTaskCounters() {
  taskCounter = 0;
  usedTitles.clear();
}

export type TaskValueKey = keyof typeof TASK_VALUES;
export type TaskValue = typeof TASK_VALUES[TaskValueKey];
export type TaskCategory = "bug" | "feature" | "chore" | "janitor";
