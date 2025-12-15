/**
 * Workspace data pools - edit THIS file when Workspace schema changes
 *
 * Structure:
 * - Named entries: Specific workspaces for deterministic scenarios
 * - Pools: Arrays for generating varied data
 */

export const WORKSPACE_VALUES = {
  // Named entries for specific scenarios
  default: {
    name: "Acme Platform",
    slug: "acme-platform",
    description: "Main product workspace for the Acme team",
  },
  secondary: {
    name: "Internal Tools",
    slug: "internal-tools",
    description: "Internal tooling and automation workspace",
  },
  demo: {
    name: "Demo Workspace",
    slug: "demo-workspace",
    description: "Demonstration workspace for onboarding",
  },
  e2eTest: {
    name: "E2E Test Workspace",
    slug: "e2e-test-workspace",
    description: "Automated E2E testing workspace",
  },
  enterprise: {
    name: "Enterprise Suite",
    slug: "enterprise-suite",
    description: "Enterprise customer workspace with full features",
  },
} as const;

// Pools for generating varied data
export const WORKSPACE_POOLS = {
  names: [
    "Project Phoenix",
    "Team Rocket",
    "Blue Sky Initiative",
    "Core Platform",
    "Innovation Lab",
    "Growth Team",
    "Mobile Squad",
    "API Gateway",
    "Customer Success",
    "DevOps Central",
    "Data Pipeline",
    "Frontend Guild",
    "Backend Services",
    "Security Ops",
    "QA Engineering",
  ],
  descriptions: [
    "Cross-functional team workspace for product development",
    "Dedicated space for infrastructure and tooling",
    "Collaborative environment for feature delivery",
    "Central hub for team coordination and planning",
    "Workspace for experimental projects and R&D",
    "Team workspace focused on user growth metrics",
    "Mobile application development workspace",
    "API design and implementation workspace",
    "Customer-facing initiatives and support",
    "Infrastructure automation and monitoring",
  ],
  slugPrefixes: [
    "team",
    "project",
    "squad",
    "workspace",
    "hub",
  ],
} as const;

// Counter for unique generation
let workspaceCounter = 0;

/**
 * Get a random workspace from the pools with unique slug
 */
export function getRandomWorkspace() {
  const name = WORKSPACE_POOLS.names[Math.floor(Math.random() * WORKSPACE_POOLS.names.length)];
  const description = WORKSPACE_POOLS.descriptions[Math.floor(Math.random() * WORKSPACE_POOLS.descriptions.length)];
  const prefix = WORKSPACE_POOLS.slugPrefixes[Math.floor(Math.random() * WORKSPACE_POOLS.slugPrefixes.length)];
  const uniqueSuffix = ++workspaceCounter;
  const slug = `${prefix}-${name.toLowerCase().replace(/\s+/g, "-")}-${uniqueSuffix}`;

  return {
    name: `${name} ${uniqueSuffix}`,
    slug,
    description,
  };
}

/**
 * Get a named workspace value by key
 */
export function getNamedWorkspace(key: keyof typeof WORKSPACE_VALUES) {
  return { ...WORKSPACE_VALUES[key] };
}

/**
 * Reset workspace counter (useful for test isolation)
 */
export function resetWorkspaceCounter() {
  workspaceCounter = 0;
}

export type WorkspaceValueKey = keyof typeof WORKSPACE_VALUES;
export type WorkspaceValue = typeof WORKSPACE_VALUES[WorkspaceValueKey];
