import { db } from "@/lib/db";
import type { Repository } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/helpers";

export interface CreateTestRepositoryOptions {
  name?: string;
  repositoryUrl?: string;
  branch?: string;
  workspaceId: string;
  testingFrameworkSetup?: boolean;
  playwrightSetup?: boolean;
}

export async function createTestRepository(
  options: CreateTestRepositoryOptions,
): Promise<Repository> {
  const uniqueId = generateUniqueId("repo");

  return db.repository.create({
    data: {
      name: options.name || `Test Repository ${uniqueId}`,
      repositoryUrl: options.repositoryUrl || `https://github.com/test/repo-${uniqueId}`,
      branch: options.branch || "main",
      workspaceId: options.workspaceId,
      testingFrameworkSetup: options.testingFrameworkSetup ?? false,
      playwrightSetup: options.playwrightSetup ?? false,
    },
  });
}
