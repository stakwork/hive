/**
 * User data pools - edit THIS file when User schema changes
 *
 * Structure:
 * - Named entries: Specific users for deterministic scenarios
 * - Pools: Arrays for generating varied data
 */

export const USER_VALUES = {
  // Named entries for specific scenarios
  owner: {
    name: "Sarah Chen",
    email: "sarah.chen@acme.dev",
    githubUsername: "sarahchen",
    role: "USER" as const,
  },
  developer: {
    name: "Marcus Johnson",
    email: "marcus.j@acme.dev",
    githubUsername: "marcusj",
    role: "USER" as const,
  },
  admin: {
    name: "Alex Rivera",
    email: "alex.r@acme.dev",
    githubUsername: "alexr",
    role: "ADMIN" as const,
  },
  pm: {
    name: "Jordan Kim",
    email: "jordan.k@acme.dev",
    githubUsername: "jordank",
    role: "USER" as const,
  },
  stakeholder: {
    name: "Taylor Morgan",
    email: "taylor.m@acme.dev",
    githubUsername: "taylorm",
    role: "USER" as const,
  },
  viewer: {
    name: "Casey Patel",
    email: "casey.p@acme.dev",
    githubUsername: "caseyp",
    role: "USER" as const,
  },
  // Mock auth user - matches E2E mock auth provider
  mockAuthUser: {
    name: "Dev User",
    email: "dev-user@mock.dev",
    githubUsername: "devuser",
    role: "USER" as const,
  },
} as const;

// Pools for generating varied data
export const USER_POOLS = {
  firstNames: [
    "Alex", "Jordan", "Taylor", "Casey", "Riley",
    "Morgan", "Quinn", "Avery", "Sage", "Skyler",
    "Cameron", "Drew", "Finley", "Harper", "Hayden",
  ],
  lastNames: [
    "Rivera", "Kim", "Patel", "Chen", "Morgan",
    "Johnson", "Williams", "Brown", "Davis", "Garcia",
    "Martinez", "Anderson", "Taylor", "Thomas", "Jackson",
  ],
  emailDomains: [
    "acme.dev",
    "techcorp.io",
    "devteam.co",
    "startup.dev",
    "engineering.io",
  ],
  roles: ["USER", "ADMIN"] as const,
} as const;

// Counter for unique generation
let userCounter = 0;

/**
 * Get a random user from the pools with unique email
 */
export function getRandomUser() {
  const firstName = USER_POOLS.firstNames[Math.floor(Math.random() * USER_POOLS.firstNames.length)];
  const lastName = USER_POOLS.lastNames[Math.floor(Math.random() * USER_POOLS.lastNames.length)];
  const domain = USER_POOLS.emailDomains[Math.floor(Math.random() * USER_POOLS.emailDomains.length)];
  const name = `${firstName} ${lastName}`;
  const uniqueSuffix = ++userCounter;
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${uniqueSuffix}@${domain}`;
  const githubUsername = `${firstName.toLowerCase()}${lastName.toLowerCase()}${uniqueSuffix}`;

  return {
    name,
    email,
    githubUsername,
    role: "USER" as const,
  };
}

/**
 * Get a named user value by key
 */
export function getNamedUser(key: keyof typeof USER_VALUES) {
  return USER_VALUES[key];
}

/**
 * Reset the user counter (useful for test isolation)
 */
export function resetUserCounter() {
  userCounter = 0;
}

export type UserValueKey = keyof typeof USER_VALUES;
export type UserValue = typeof USER_VALUES[UserValueKey];
