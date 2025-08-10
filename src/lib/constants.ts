// Reserved workspace slugs to prevent conflicts with system routes
export const RESERVED_WORKSPACE_SLUGS = [
  // System routes
  "api",
  "admin",
  "dashboard",
  "settings",
  "auth",
  "login",
  "logout",
  "signup",
  "register",
  "signin",
  "signout",
  "onboarding",

  // Help & Support
  "help",
  "support",
  "docs",
  "documentation",
  "faq",
  "contact",

  // Infrastructure
  "www",
  "mail",
  "email",
  "blog",
  "news",
  "status",
  "health",
  "graphql",
  "webhook",
  "callback",
  "oauth",
  "cdn",
  "assets",
  "static",
  "public",
  "private",
  "uploads",
  "downloads",

  // Environment
  "test",
  "testing",
  "staging",
  "stage",
  "prod",
  "production",
  "dev",
  "development",
  "preview",
  "demo",

  // App-specific routes
  "workspaces",
  "workspace",
  "user",
  "users",
  "profile",
  "account",
  "billing",
  "subscription",
  "pricing",
  "features",
  "roadmap",
  "tasks",
  "projects",
  "repositories",
  "repos",
  "code-graph",
  "stakgraph",
  "swarm",
  "pool-manager",

  // Common conflicts
  "app",
  "web",
  "site",
  "home",
  "index",
  "main",
  "root",
  "about",
  "terms",
  "privacy",
  "legal",
  "security",

  // Technical
  "robots",
  "sitemap",
  "manifest",
  "favicon",
  "sw",
] as const;

// Workspace slug validation patterns
export const WORKSPACE_SLUG_PATTERNS = {
  VALID: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
  MIN_LENGTH: 2,
  MAX_LENGTH: 50,
} as const;

// Workspace access levels for permission checking
export const WORKSPACE_PERMISSION_LEVELS = {
  VIEWER: 0,
  STAKEHOLDER: 1,
  DEVELOPER: 2,
  PM: 3,
  ADMIN: 4,
  OWNER: 5,
} as const;

// Error messages
export const WORKSPACE_ERRORS = {
  NOT_FOUND: "Workspace not found",
  ACCESS_DENIED: "Access denied to this workspace",
  SLUG_RESERVED:
    "This workspace name is reserved. Please choose a different name.",
  SLUG_INVALID_FORMAT:
    "Workspace name must start and end with letters or numbers, and can only contain letters, numbers, and hyphens.",
  SLUG_INVALID_LENGTH: "Workspace name must be between 2 and 50 characters.",
  SLUG_ALREADY_EXISTS:
    "A workspace with this name already exists. Please choose a different name.",
} as const;

// Swarm creation defaults
export const SWARM_DEFAULT_INSTANCE_TYPE = "m6i.xlarge";
export const SWARM_DEFAULT_ENV_VARS = {
  JARVIS_FEATURE_FLAG_WFA_SCHEMAS: "true",
  JARVIS_FEATURE_FLAG_CODEGRAPH_SCHEMAS: "true",
};
export function getSwarmVanityAddress(name: string) {
  return `${name}.sphinx.chat`;
}

// Preview targets for bug identification feature
export const PREVIEW_TARGETS = {
  DEV_DEFAULT: 'https://hive-vercel.sphinx.chat',
} as const;
