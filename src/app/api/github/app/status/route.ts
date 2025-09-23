import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getUserAppTokens } from "@/lib/githubApp";
// import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ hasTokens: false }, { status: 200 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspaceSlug");

    let hasTokens = false;

    if (workspaceSlug) {
      // Check if user has tokens for this specific workspace's GitHub org
      const { db } = await import("@/lib/db");

      // Get workspace and its repository URL
      const workspace = await db.workspace.findUnique({
        where: { slug: workspaceSlug },
        include: { swarm: true, sourceControlOrg: true }
      });

      if (workspace?.sourceControlOrg) {
        // Workspace is linked to a SourceControlOrg - check if user has tokens for it
        const sourceControlToken = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: session.user.id,
              sourceControlOrgId: workspace.sourceControlOrg.id,
            },
          },
        });
        hasTokens = !!sourceControlToken;
      } else if (workspace?.swarm?.repositoryUrl) {
        // Workspace not linked yet - extract GitHub org from repo URL and check
        const repoUrl = workspace.swarm.repositoryUrl;
        const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)/);

        if (githubMatch) {
          const githubOwner = githubMatch[1];
          const apptokens = await getUserAppTokens(session.user.id, githubOwner);
          hasTokens = !!apptokens?.accessToken;
        }
      }
    } else {
      // No workspace specified - check if user has ANY GitHub App tokens
      const apptokens = await getUserAppTokens(session.user.id);
      hasTokens = !!apptokens?.accessToken;
    }

    // if (hasTokens) {
    //   const encryptionService = EncryptionService.getInstance();
    //   const accessToken = encryptionService.decryptField("app_access_token", apptokens.accessToken as string);
    //   console.log("=> accessToken", accessToken);
    // }

    return NextResponse.json({ hasTokens }, { status: 200 });
  } catch (error) {
    console.error("Failed to check GitHub App status", error);
    return NextResponse.json({ hasTokens: false }, { status: 200 });
  }
}
