/**
 * Task Values
 * 
 * Deterministic and random data pools for task entities.
 * Provides consistent test data across fixtures and scenarios.
 */

export interface TaskValue {
  title: string;
  description?: string;
  status?: string;
  type?: string;
}

/**
 * Named task entries for deterministic test scenarios
 */
export const namedTasks: Record<string, TaskValue> = {
  setupDatabase: {
    title: "Setup Database Schema",
    description: "Initialize database with required tables and relationships",
    status: "TODO",
    type: "technical",
  },
  implementAuth: {
    title: "Implement Authentication",
    description: "Add user authentication with NextAuth.js and GitHub OAuth",
    status: "IN_PROGRESS",
    type: "feature",
  },
  writeTests: {
    title: "Write Unit Tests",
    description: "Add comprehensive unit test coverage for core modules",
    status: "TODO",
    type: "testing",
  },
  fixBug: {
    title: "Fix Login Bug",
    description: "Resolve issue with session persistence after login",
    status: "BLOCKED",
    type: "bug",
  },
  deployProd: {
    title: "Deploy to Production",
    description: "Production deployment with database migration",
    status: "DONE",
    type: "deployment",
  },
};

/**
 * Task description pool for varied test data
 */
export const descriptionPool: string[] = [
  "Implement new feature according to specifications",
  "Refactor existing code for better maintainability",
  "Add error handling and validation",
  "Update documentation with latest changes",
  "Optimize database queries for performance",
  "Fix reported issue with detailed reproduction steps",
  "Add integration tests for new endpoints",
  "Review and merge pull request",
  "Configure CI/CD pipeline",
  "Analyze performance metrics and identify bottlenecks",
];

/**
 * Random task pool for varied test data
 */
export const randomTaskPool: TaskValue[] = [
  {
    title: "Add API Rate Limiting",
    description: "Implement rate limiting for public API endpoints",
    status: "TODO",
    type: "feature",
  },
  {
    title: "Optimize Image Loading",
    description: "Reduce initial page load time by lazy loading images",
    status: "IN_PROGRESS",
    type: "performance",
  },
  {
    title: "Security Audit",
    description: "Conduct security review of authentication flow",
    status: "TODO",
    type: "security",
  },
  {
    title: "Migrate to TypeScript",
    description: "Convert JavaScript modules to TypeScript",
    status: "IN_PROGRESS",
    type: "technical",
  },
  {
    title: "Add Dark Mode",
    description: "Implement dark mode theme toggle",
    status: "DONE",
    type: "feature",
  },
  {
    title: "Fix Mobile Layout",
    description: "Resolve responsive layout issues on mobile devices",
    status: "TODO",
    type: "bug",
  },
  {
    title: "Update Dependencies",
    description: "Update npm packages to latest stable versions",
    status: "TODO",
    type: "maintenance",
  },
  {
    title: "Add E2E Tests",
    description: "Write end-to-end tests for critical user flows",
    status: "IN_PROGRESS",
    type: "testing",
  },
];

/**
 * Get random task from pool
 */
export function getRandomTask(): TaskValue {
  return randomTaskPool[Math.floor(Math.random() * randomTaskPool.length)];
}

/**
 * Get random description from pool
 */
export function getRandomDescription(): string {
  return descriptionPool[Math.floor(Math.random() * descriptionPool.length)];
}

/**
 * Generate task title with type prefix
 */
export function generateTaskTitle(type: string, action: string): string {
  return `[${type.toUpperCase()}] ${action}`;
}

/**
 * Exported values object for convenience
 */
export const TASK_VALUES = {
  namedTasks,
  descriptionPool,
  randomTaskPool,
  getRandomTask,
  getRandomDescription,
  generateTaskTitle,
};
