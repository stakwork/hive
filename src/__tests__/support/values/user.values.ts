/**
 * User Values
 * 
 * Deterministic and random data pools for user entities.
 * Provides consistent test data across fixtures and scenarios.
 */

export interface UserValue {
  name: string;
  email: string;
  role?: string;
}

/**
 * Mock auth user - aligns with existing mock auth provider (dev-user@mock.dev)
 * Used for authentication in mock mode and E2E tests
 */
export const mockAuthUser: UserValue = {
  name: "Dev User",
  email: "dev-user@mock.dev",
  role: "developer",
};

/**
 * Named user entries for deterministic test scenarios
 */
export const namedUsers: Record<string, UserValue> = {
  admin: {
    name: "Admin User",
    email: "admin@test.example",
    role: "admin",
  },
  developer: {
    name: "Developer User",
    email: "developer@test.example",
    role: "developer",
  },
  viewer: {
    name: "Viewer User",
    email: "viewer@test.example",
    role: "viewer",
  },
  pm: {
    name: "Product Manager",
    email: "pm@test.example",
    role: "pm",
  },
  stakeholder: {
    name: "Stakeholder User",
    email: "stakeholder@test.example",
    role: "stakeholder",
  },
};

/**
 * Random user pool for varied test data
 */
export const randomUserPool: UserValue[] = [
  { name: "Alice Johnson", email: "alice.johnson@test.example", role: "developer" },
  { name: "Bob Smith", email: "bob.smith@test.example", role: "developer" },
  { name: "Carol Williams", email: "carol.williams@test.example", role: "admin" },
  { name: "David Brown", email: "david.brown@test.example", role: "pm" },
  { name: "Eve Davis", email: "eve.davis@test.example", role: "stakeholder" },
  { name: "Frank Miller", email: "frank.miller@test.example", role: "developer" },
  { name: "Grace Wilson", email: "grace.wilson@test.example", role: "viewer" },
  { name: "Henry Moore", email: "henry.moore@test.example", role: "developer" },
  { name: "Ivy Taylor", email: "ivy.taylor@test.example", role: "admin" },
  { name: "Jack Anderson", email: "jack.anderson@test.example", role: "pm" },
];

/**
 * Get random user from pool
 */
export function getRandomUser(): UserValue {
  return randomUserPool[Math.floor(Math.random() * randomUserPool.length)];
}

/**
 * Generate random password for test users
 */
export function generateRandomPassword(length: number = 16): string {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  return password;
}

/**
 * Exported values object for convenience
 */
export const USER_VALUES = {
  mockAuthUser,
  namedUsers,
  randomUserPool,
  getRandomUser,
  generateRandomPassword,
};
