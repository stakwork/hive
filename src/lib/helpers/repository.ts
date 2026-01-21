import { db } from "@/lib/db";

export type RepositoryInfo = {
  id: string;
  repositoryUrl: string;
  ignoreDirs: string | null;
  unitGlob: string | null;
  integrationGlob: string | null;
  e2eGlob: string | null;
  name: string;
  description: string | null;
  branch: string;
};

export async function getPrimaryRepository(workspaceId: string): Promise<RepositoryInfo | null> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      repositories: {
        select: {
          id: true,
          repositoryUrl: true,
          ignoreDirs: true,
          unitGlob: true,
          integrationGlob: true,
          e2eGlob: true,
          name: true,
          description: true,
          branch: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!workspace || workspace.repositories.length === 0) {
    return null;
  }

  const primaryRepo = workspace.repositories[0];

  return {
    id: primaryRepo.id,
    repositoryUrl: primaryRepo.repositoryUrl,
    ignoreDirs: primaryRepo.ignoreDirs,
    unitGlob: primaryRepo.unitGlob,
    integrationGlob: primaryRepo.integrationGlob,
    e2eGlob: primaryRepo.e2eGlob,
    name: primaryRepo.name,
    description: primaryRepo.description,
    branch: primaryRepo.branch,
  };
}

export async function getAllRepositories(workspaceId: string): Promise<RepositoryInfo[]> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      repositories: {
        select: {
          id: true,
          repositoryUrl: true,
          ignoreDirs: true,
          unitGlob: true,
          integrationGlob: true,
          e2eGlob: true,
          name: true,
          description: true,
          branch: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!workspace) {
    return [];
  }

  return workspace.repositories.map((repo) => ({
    id: repo.id,
    repositoryUrl: repo.repositoryUrl,
    ignoreDirs: repo.ignoreDirs,
    unitGlob: repo.unitGlob,
    integrationGlob: repo.integrationGlob,
    e2eGlob: repo.e2eGlob,
    name: repo.name,
    description: repo.description,
    branch: repo.branch,
  }));
}
