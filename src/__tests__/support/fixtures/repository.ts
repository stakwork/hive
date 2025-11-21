import { db } from "@/lib/db";
import type { Repository, RepositoryStatus } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

export interface CreateTestRepositoryOptions {
  name?: string;
  repositoryUrl?: string;
  branch?: string;
  workspaceId: string;
  status?: RepositoryStatus;
  testingFrameworkSetup?: boolean;
  playwrightSetup?: boolean;
}

export async function createTestRepository(options: CreateTestRepositoryOptions): Promise<Repository> {
  const uniqueId = generateUniqueId("repo");

  return db.repository.create({
    data: {
      name: options.name || `Test Repository ${uniqueId}`,
      repositoryUrl: options.repositoryUrl || `https://github.com/test/repo-${uniqueId}`,
      branch: options.branch || "main",
      workspaceId: options.workspaceId,
      status: options.status,
      testingFrameworkSetup: options.testingFrameworkSetup ?? false,
      playwrightSetup: options.playwrightSetup ?? false,
    },
  });
}
