/**
 * Test fixtures for feature data used in AI utils tests
 */

import { db } from "@/lib/db";
import type { Feature, Phase } from "@prisma/client";

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
 * Creates a test feature in the database
 */
export async function createTestFeature(params: {
  workspaceId: string;
  createdById: string;
  title?: string;
  updatedById?: string;
}): Promise<Feature> {
  return db.feature.create({
    data: {
      title: params.title || "Test Feature",
      workspaceId: params.workspaceId,
      createdById: params.createdById,
      updatedById: params.updatedById || params.createdById,
    },
  });
}

/**
 * Creates a test phase in the database
 */
export async function createTestPhase(params: {
  featureId: string;
  name?: string;
  order?: number;
}): Promise<Phase> {
  return db.phase.create({
    data: {
      featureId: params.featureId,
      name: params.name || "Test Phase",
      order: params.order ?? 0,
    },
  });
}
