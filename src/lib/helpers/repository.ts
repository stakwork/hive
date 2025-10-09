import { db } from "@/lib/db";

export async function getPrimaryRepository(workspaceId: string): Promise<{
  id: string;
  repositoryUrl: string;
  ignoreDirs: string | null;
  name: string;
  description: string | null;
  branch: string;
} | null> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      repositories: {
        select: {
          id: true,
          repositoryUrl: true,
          ignoreDirs: true,
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
    name: primaryRepo.name,
    description: primaryRepo.description,
    branch: primaryRepo.branch,
  };
}
