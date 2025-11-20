/**
 * Mock data helpers for task-coordinator tests
 * Provides reusable factory functions for creating test fixtures
 */

export interface MockFeatureOptions {
  id?: string;
  title?: string;
  brief?: string | null;
  requirements?: string | null;
  architecture?: string | null;
  userStories?: Array<{ id: string; title: string; order: number; description?: string | null }>;
}

export interface MockPhaseOptions {
  id?: string;
  name?: string;
  description?: string | null;
  tasks?: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
  }>;
}

/**
 * Creates a mock feature object with sensible defaults
 */
export function createMockFeature(options: MockFeatureOptions = {}) {
  return {
    id: options.id || "feature-1",
    title: options.title || "Test Feature",
    brief: options.brief !== undefined ? options.brief : null,
    requirements: options.requirements !== undefined ? options.requirements : null,
    architecture: options.architecture !== undefined ? options.architecture : null,
    userStories: options.userStories || [],
  };
}

/**
 * Creates a mock phase object with sensible defaults
 */
export function createMockPhase(options: MockPhaseOptions = {}) {
  return {
    id: options.id || "phase-1",
    name: options.name || "Test Phase",
    description: options.description !== undefined ? options.description : null,
    tasks: options.tasks || [],
  };
}

/**
 * Creates a complete feature with all fields populated
 */
export function createCompleteFeature(overrides: Partial<MockFeatureOptions> = {}) {
  return createMockFeature({
    id: "feature-1",
    title: "Payment Integration",
    brief: "Add Stripe payment processing",
    requirements: "Support credit cards and ACH payments",
    architecture: "Microservice-based payment gateway",
    userStories: [
      { id: "us-1", title: "As a customer, I want to pay by credit card", order: 0 },
      { id: "us-2", title: "As a customer, I want to pay by bank transfer", order: 1 },
    ],
    ...overrides,
  });
}

/**
 * Creates a complete phase with tasks
 */
export function createCompletePhase(overrides: Partial<MockPhaseOptions> = {}) {
  return createMockPhase({
    id: "phase-1",
    name: "Development Phase",
    description: "Implementation and testing",
    tasks: [
      { id: "task-1", title: "Setup Stripe API", description: "Configure Stripe SDK", status: "TODO" },
      { id: "task-2", title: "Create payment endpoint", description: "Build REST API", status: "IN_PROGRESS" },
    ],
    ...overrides,
  });
}

/**
 * Creates a minimal feature with only required fields
 */
export function createMinimalFeature(overrides: Partial<MockFeatureOptions> = {}) {
  return createMockFeature({
    id: "feature-minimal",
    title: "Minimal Feature",
    brief: null,
    requirements: null,
    architecture: null,
    userStories: [],
    ...overrides,
  });
}

/**
 * Creates a minimal phase with no tasks
 */
export function createMinimalPhase(overrides: Partial<MockPhaseOptions> = {}) {
  return createMockPhase({
    id: "phase-minimal",
    name: "Minimal Phase",
    description: null,
    tasks: [],
    ...overrides,
  });
}
