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

export async function POST(
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

    const commitInfo = await fetchLatestCommitHash(
      encryptionService.decryptField("access_token", account.access_token),
      owner,
      repoName,
      defaultBranch,
    );

    if (!commitInfo) {
      return NextResponse.json(
        { success: false, message: "Failed to fetch commits" },
        { status: 500 },
      );
    }

    await db.repository.updateMany({
      where: { workspaceId: workspace.id },
      data: {
        commitHash: commitInfo.hash,
        lastCommitDate: commitInfo.date,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        hash: commitInfo.hash,
        date: commitInfo.date,
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
