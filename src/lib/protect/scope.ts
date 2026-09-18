import { db } from "@/lib/db";
import { canonicalRepoKey } from "@/lib/utils/error-fingerprint";

export interface ProtectScopedRepository {
  id: string;
  name: string;
  repositoryUrl: string;
  canonicalUrl: string;
}

export interface ProtectScopePayload {
  repositories: Array<{
    id: string;
    name: string;
    repositoryUrl: string;
    inScope: boolean;
  }>;
  selected: Array<{
    id: string;
    repositoryUrl: string;
  }>;
  empty: boolean;
}

export function sameCanonicalRepo(a: string, b: string): boolean {
  const left = canonicalRepoKey(a);
  const right = canonicalRepoKey(b);
  return left !== "unknown" && left === right;
}

export async function listWorkspaceRepositories(
  workspaceId: string,
): Promise<Array<{ id: string; name: string; repositoryUrl: string }>> {
  return db.repository.findMany({
    where: { workspaceId },
    select: { id: true, name: true, repositoryUrl: true },
    orderBy: { name: "asc" },
  });
}

export async function loadProtectScopeRepos(
  workspaceId: string,
): Promise<ProtectScopedRepository[]> {
  const scoped = await db.protectReviewRepo.findMany({
    where: { workspaceId },
    select: {
      repository: {
        select: { id: true, name: true, repositoryUrl: true },
      },
    },
  });

  return scoped
    .map((row) => row.repository)
    .filter((repo): repo is { id: string; name: string; repositoryUrl: string } =>
      Boolean(repo?.repositoryUrl?.trim()),
    )
    .map((repo) => ({
      id: repo.id,
      name: repo.name,
      repositoryUrl: repo.repositoryUrl,
      canonicalUrl: canonicalRepoKey(repo.repositoryUrl),
    }));
}

export async function getProtectScopePayload(
  workspaceId: string,
): Promise<ProtectScopePayload> {
  const [repositories, scoped] = await Promise.all([
    listWorkspaceRepositories(workspaceId),
    db.protectReviewRepo.findMany({
      where: { workspaceId },
      select: { repositoryId: true },
    }),
  ]);

  const inScopeIds = new Set(scoped.map((row) => row.repositoryId));
  const selected = repositories
    .filter((repo) => inScopeIds.has(repo.id))
    .map((repo) => ({ id: repo.id, repositoryUrl: repo.repositoryUrl }));

  return {
    repositories: repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      repositoryUrl: repo.repositoryUrl,
      inScope: inScopeIds.has(repo.id),
    })),
    selected,
    empty: selected.length === 0,
  };
}

export async function findWorkspaceRepositoryById(
  workspaceId: string,
  repositoryId: string,
): Promise<{ id: string; name: string; repositoryUrl: string } | null> {
  return db.repository.findFirst({
    where: { id: repositoryId, workspaceId },
    select: { id: true, name: true, repositoryUrl: true },
  });
}

export async function addRepositoryToProtectScope(
  workspaceId: string,
  repositoryId: string,
): Promise<ProtectScopePayload> {
  const repository = await findWorkspaceRepositoryById(workspaceId, repositoryId);
  if (!repository) {
    throw new Error("REPOSITORY_NOT_FOUND");
  }

  await db.protectReviewRepo.upsert({
    where: {
      workspaceId_repositoryId: { workspaceId, repositoryId },
    },
    create: { workspaceId, repositoryId },
    update: {},
  });

  return getProtectScopePayload(workspaceId);
}

export async function removeRepositoryFromProtectScope(
  workspaceId: string,
  repositoryId: string,
): Promise<ProtectScopePayload> {
  const repository = await findWorkspaceRepositoryById(workspaceId, repositoryId);
  if (!repository) {
    throw new Error("REPOSITORY_NOT_FOUND");
  }

  await db.protectReviewRepo.deleteMany({
    where: { workspaceId, repositoryId },
  });

  return getProtectScopePayload(workspaceId);
}

export async function hasCompletedFullRunForRepository(
  workspaceId: string,
  repositoryUrl: string,
): Promise<boolean> {
  const canonicalUrl = canonicalRepoKey(repositoryUrl);
  if (canonicalUrl === "unknown") return false;

  const match = await db.protectReviewRunRepo.findFirst({
    where: {
      canonicalUrl,
      run: {
        workspaceId,
        mode: "full",
        status: "completed",
      },
    },
    select: { id: true },
  });

  return Boolean(match);
}

export async function snapshotProtectRunRepos(
  runId: string,
  repos: ProtectScopedRepository[],
): Promise<void> {
  if (repos.length === 0) return;

  await db.protectReviewRunRepo.createMany({
    data: repos.map((repo) => ({
      runId,
      repositoryId: repo.id,
      canonicalUrl: repo.canonicalUrl,
    })),
    skipDuplicates: true,
  });
}

export async function loadProtectRunSnapshotCanonicalUrls(
  runId: string,
): Promise<string[]> {
  const rows = await db.protectReviewRunRepo.findMany({
    where: { runId },
    select: { canonicalUrl: true },
  });
  return rows.map((row) => row.canonicalUrl);
}

