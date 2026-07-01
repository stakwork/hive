import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { checkRepoAllowsAutoMerge, getOctokitForWorkspace, parsePRUrl } from "@/lib/github";
import { logger } from "@/lib/logger";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const LOG_PREFIX = "[AutoMergeRoute]";

export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // 2. Parse repositoryId from query params
    const { searchParams } = new URL(request.url);
    const repositoryId = searchParams.get("repositoryId");
    if (!repositoryId) {
      return NextResponse.json(
        { error: "repositoryId query parameter is required" },
        { status: 400 }
      );
    }

    // 3. Load repository from DB
    const repository = await db.repository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        repositoryUrl: true,
        allowAutoMerge: true,
        workspaceId: true,
        workspace: {
          select: { ownerId: true },
        },
      },
    });

    if (!repository) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    // 4. IDOR: verify the authenticated user belongs to repository's workspace
    const isOwner = repository.workspace.ownerId === userId;
    if (!isOwner) {
      const membership = await db.workspaceMember.findFirst({
        where: {
          workspaceId: repository.workspaceId,
          userId,
          leftAt: null,
        },
      });
      if (!membership) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 }
        );
      }
    }

    // 5. Cache hit — skip GitHub call
    if (repository.allowAutoMerge === true) {
      return NextResponse.json({ allowed: true });
    }

    // 6. Parse owner/repo from repositoryUrl
    const parsed = parsePRUrl(`${repository.repositoryUrl}/pull/1`);
    if (!parsed) {
      logger.warn(`${LOG_PREFIX} Could not parse repository URL`, repository.repositoryUrl);
      return NextResponse.json({ allowed: false });
    }
    const { owner, repo } = parsed;

    // 7. Get authenticated Octokit client
    const octokit = await getOctokitForWorkspace(userId, owner);
    if (!octokit) {
      logger.warn(`${LOG_PREFIX} No Octokit token for user`, userId, owner);
      return NextResponse.json({ allowed: false });
    }

    // 8. Live GitHub check
    const result = await checkRepoAllowsAutoMerge(octokit, owner, repo);

    // 9. Cache positive result
    if (result.allowed) {
      await db.repository.update({
        where: { id: repositoryId },
        data: { allowAutoMerge: true },
      });
    }

    // 10. Return result
    return NextResponse.json({ allowed: result.allowed });
  } catch (error) {
    logger.error(`${LOG_PREFIX} Unexpected error`, undefined, { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
