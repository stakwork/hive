import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getWorkspaceBySlug } from "@/services/workspace";
import { fetchLatestCommitHash } from "@/services/github/api/webhooks";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

const encryptionService = EncryptionService.getInstance();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const workspace = await getWorkspaceBySlug(slug, session.user.id);
    if (!workspace) {
      return NextResponse.json(
        { success: false, message: "Workspace not found" },
        { status: 404 },
      );
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!swarm?.repositoryUrl) {
      return NextResponse.json(
        { success: false, message: "No repository configured" },
        { status: 400 },
      );
    }

    const repository = await db.repository.findFirst({
      where: { workspaceId: workspace.id },
      select: { commitHash: true, lastCommitDate: true, branch: true },
    });

    if (!repository) {
      return NextResponse.json(
        { success: false, message: "Repository not found" },
        { status: 404 },
      );
    }

    const account = await db.account.findFirst({
      where: { userId: session.user.id, provider: "github" },
      select: { access_token: true },
    });

    if (!account?.access_token) {
      return NextResponse.json(
        { success: false, message: "GitHub access token not found" },
        { status: 400 },
      );
    }

    const { owner, repo: repoName } = parseGithubOwnerRepo(swarm.repositoryUrl);
    const defaultBranch = swarm.defaultBranch || "main";

    const latestCommitInfo = await fetchLatestCommitHash(
      encryptionService.decryptField("access_token", account.access_token),
      owner,
      repoName,
      defaultBranch,
    );

    if (!latestCommitInfo) {
      return NextResponse.json(
        { success: false, message: "Failed to fetch latest commit" },
        { status: 500 },
      );
    }

    const needsSync = repository.commitHash !== latestCommitInfo.hash;

    return NextResponse.json({
      success: true,
      data: {
        storedHash: repository.commitHash,
        latestHash: latestCommitInfo.hash,
        needsSync,
        lastSync: repository.lastCommitDate,
        latestCommitDate: latestCommitInfo.date,
        branch: defaultBranch,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
