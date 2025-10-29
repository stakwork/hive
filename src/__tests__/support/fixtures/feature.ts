/**
 * Test fixtures for feature data used in AI utils tests
 */

import { db } from "@/lib/db";
import type { Feature } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

type FeatureData = {
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

export interface CreateTestFeatureOptions {
  title?: string;
  workspaceId: string;
  createdById: string;
  updatedById?: string;
  brief?: string;
  personas?: string[];
}

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

/**
 * Creates a test feature in the database with sensible defaults
 */
export async function createTestFeature(
  options: CreateTestFeatureOptions
): Promise<Feature> {
  const uniqueId = generateUniqueId("feature");

  return db.feature.create({
    data: {
      title: options.title || `Test Feature ${uniqueId}`,
      workspaceId: options.workspaceId,
      createdById: options.createdById,
      updatedById: options.updatedById || options.createdById,
      brief: options.brief || null,
      personas: options.personas || [],
    },
  });
}
