/**
 * In-memory feature data fixtures for AI utils tests
 * These are declarative data providers, not DB creators
 */

export type FeatureData = {
  id: string;
  title: string;
  brief: string | null;
  personas: string[];
  requirements: string | null;
  architecture: string | null;
  userStories: { title: string }[];
  workspace: {
    description: string | null;
  };
};

/**
 * Creates a minimal feature data object with only required fields
 */
export function createMinimalFeatureData(overrides: Partial<FeatureData> = {}): FeatureData {
  return {
    id: "feature-123",
    title: "Test Feature",
    brief: null,
    personas: [],
    requirements: null,
    architecture: null,
    userStories: [],
    workspace: { description: null },
    ...overrides,
  };
}

/**
 * Creates a complete feature data object with all fields populated
 */
export function createCompleteFeatureData(overrides: Partial<FeatureData> = {}): FeatureData {
  return {
    id: "feature-123",
    title: "Payment Integration",
    brief: "Add Stripe payment processing",
    personas: ["Customer", "Admin", "Developer"],
    requirements: "Must support credit cards and ACH payments",
    architecture: "Use Stripe SDK with webhook handlers",
    userStories: [
      { title: "Customer can checkout with credit card" },
      { title: "Admin can view payment history" },
    ],
    workspace: {
      description: "E-commerce platform for online retail",
    },
    ...overrides,
  };
}
