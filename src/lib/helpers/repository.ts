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
  // Sync configuration
  codeIngestionEnabled: boolean;
  docsEnabled: boolean;
  mocksEnabled: boolean;
  embeddingsEnabled: boolean;
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
          codeIngestionEnabled: true,
          docsEnabled: true,
          mocksEnabled: true,
          embeddingsEnabled: true,
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
    codeIngestionEnabled: primaryRepo.codeIngestionEnabled,
    docsEnabled: primaryRepo.docsEnabled,
    mocksEnabled: primaryRepo.mocksEnabled,
    embeddingsEnabled: primaryRepo.embeddingsEnabled,
  };
}

export async function getRepositoryById(repositoryId: string, workspaceId: string): Promise<RepositoryInfo | null> {
  const repo = await db.repository.findUnique({
    where: { id: repositoryId },
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
      codeIngestionEnabled: true,
      docsEnabled: true,
      mocksEnabled: true,
      embeddingsEnabled: true,
      workspaceId: true,
    },
  });

  if (!repo || repo.workspaceId !== workspaceId) {
    return null;
  }

  return {
    id: repo.id,
    repositoryUrl: repo.repositoryUrl,
    ignoreDirs: repo.ignoreDirs,
    unitGlob: repo.unitGlob,
    integrationGlob: repo.integrationGlob,
    e2eGlob: repo.e2eGlob,
    name: repo.name,
    description: repo.description,
    branch: repo.branch,
    codeIngestionEnabled: repo.codeIngestionEnabled,
    docsEnabled: repo.docsEnabled,
    mocksEnabled: repo.mocksEnabled,
    embeddingsEnabled: repo.embeddingsEnabled,
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
          codeIngestionEnabled: true,
          docsEnabled: true,
          mocksEnabled: true,
          embeddingsEnabled: true,
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
    codeIngestionEnabled: repo.codeIngestionEnabled,
    docsEnabled: repo.docsEnabled,
    mocksEnabled: repo.mocksEnabled,
    embeddingsEnabled: repo.embeddingsEnabled,
  }));
}

/**
 * Joins an array of repository objects into a comma-separated URL string,
 * matching the format expected by Stakwork's `repo_url` parameter.
 * Returns null if the array is empty.
 */
export function joinRepoUrls(
  repos: { repositoryUrl: string }[]
): string | null {
  if (!repos.length) return null;
  return repos.map((r) => r.repositoryUrl).join(",");
}
