/**
 * Workspace Values
 * 
 * Deterministic and random data pools for workspace entities.
 * Provides consistent test data across fixtures and scenarios.
 */

export interface WorkspaceValue {
  name: string;
  slug: string;
  description?: string;
}

/**
 * Named workspace entries for deterministic test scenarios
 */
export const namedWorkspaces: Record<string, WorkspaceValue> = {
  product: {
    name: "Product Team",
    slug: "product-team",
    description: "Product management and roadmap planning",
  },
  engineering: {
    name: "Engineering Team",
    slug: "engineering-team",
    description: "Software development and technical operations",
  },
  design: {
    name: "Design Team",
    slug: "design-team",
    description: "User experience and interface design",
  },
  qa: {
    name: "QA Team",
    slug: "qa-team",
    description: "Quality assurance and testing",
  },
  devops: {
    name: "DevOps Team",
    slug: "devops-team",
    description: "Infrastructure and deployment automation",
  },
};

/**
 * Random workspace pool for varied test data
 */
export const randomWorkspacePool: WorkspaceValue[] = [
  {
    name: "Alpha Project",
    slug: "alpha-project",
    description: "Early stage development initiative",
  },
  {
    name: "Beta Workspace",
    slug: "beta-workspace",
    description: "Beta testing and validation environment",
  },
  {
    name: "Gamma Team",
    slug: "gamma-team",
    description: "Experimental features and research",
  },
  {
    name: "Delta Squad",
    slug: "delta-squad",
    description: "Rapid response and hotfix team",
  },
  {
    name: "Epsilon Labs",
    slug: "epsilon-labs",
    description: "Innovation and prototyping workspace",
  },
  {
    name: "Zeta Division",
    slug: "zeta-division",
    description: "Enterprise solutions and integrations",
  },
  {
    name: "Eta Platform",
    slug: "eta-platform",
    description: "Platform engineering and infrastructure",
  },
  {
    name: "Theta Group",
    slug: "theta-group",
    description: "Cross-functional collaboration space",
  },
];

/**
 * Get random workspace from pool
 */
export function getRandomWorkspace(): WorkspaceValue {
  return randomWorkspacePool[Math.floor(Math.random() * randomWorkspacePool.length)];
}

/**
 * Generate slug from workspace name
 */
export function generateSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generate unique workspace slug with random suffix
 */
export function generateUniqueSlug(baseName: string): string {
  const slug = generateSlugFromName(baseName);
  const randomSuffix = Math.floor(Math.random() * 10000);
  return `${slug}-${randomSuffix}`;
}

/**
 * Exported values object for convenience
 */
export const WORKSPACE_VALUES = {
  namedWorkspaces,
  randomWorkspacePool,
  getRandomWorkspace,
  generateSlugFromName,
  generateUniqueSlug,
};
