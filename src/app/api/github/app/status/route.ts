import { authOptions } from "@/lib/auth/nextauth";
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
// import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ hasTokens: false, hasRepoAccess: false }, { status: 200 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspaceSlug");
    const repositoryUrl = searchParams.get("repositoryUrl");

    let hasTokens = false;
    let hasRepoAccess = false;

    if (workspaceSlug) {
      // Check if user has tokens for this specific workspace's GitHub org
      const { db } = await import("@/lib/db");

      // Get workspace and optionally its swarm (only if repositoryUrl param not provided)
      const workspace = await db.workspace.findUnique({
        where: { slug: workspaceSlug },
        include: {
          swarm: true, // Always include swarm to get installation ID
          sourceControlOrg: true,
        },
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

        // Check repository access if we have tokens and a repository URL
        if (
          hasTokens &&
          (repositoryUrl || workspace?.swarm?.repositoryUrl) &&
          workspace?.sourceControlOrg?.githubInstallationId
        ) {
          const repoUrl = repositoryUrl || workspace?.swarm?.repositoryUrl;
          console.log("[STATUS ROUTE] Checking repository access:", {
            userId: session.user.id,
            installationId: workspace.sourceControlOrg.githubInstallationId,
            repositoryUrl: repoUrl,
          });
          if (repoUrl) {
            hasRepoAccess = await checkRepositoryAccess(
              session.user.id,
              workspace.sourceControlOrg.githubInstallationId.toString(),
              repoUrl,
            );
            console.log("[STATUS ROUTE] Repository access result:", hasRepoAccess);
          }
        } else {
          console.log("[STATUS ROUTE] Skipping repository access check:", {
            hasTokens,
            hasRepoUrl: !!(repositoryUrl || workspace?.swarm?.repositoryUrl),
            hasInstallationId: !!workspace?.sourceControlOrg?.githubInstallationId,
            repositoryUrl: repositoryUrl || workspace?.swarm?.repositoryUrl,
            installationId: workspace?.sourceControlOrg?.githubInstallationId,
          });
        }
      } else if (repositoryUrl || workspace?.swarm?.repositoryUrl) {
        // Workspace not linked yet - extract GitHub org from repo URL and check
        const repoUrl = repositoryUrl || workspace?.swarm?.repositoryUrl;
        if (!repoUrl) {
          console.warn("No repository URL found for workspace", workspaceSlug);
          return NextResponse.json({ hasTokens: false }, { status: 200 });
        }
        const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)/);

        if (githubMatch) {
          const githubOwner = githubMatch[1];

          // Check if there's already a SourceControlOrg for this GitHub owner
          const sourceControlOrg = await db.sourceControlOrg.findUnique({
            where: { githubLogin: githubOwner },
          });

          if (sourceControlOrg) {
            // SourceControlOrg exists - automatically link this workspace to it
            await db.workspace.update({
              where: { slug: workspaceSlug },
              data: { sourceControlOrgId: sourceControlOrg.id },
            });

            // Now check if user has tokens for it
            const sourceControlToken = await db.sourceControlToken.findUnique({
              where: {
                userId_sourceControlOrgId: {
                  userId: session.user.id,
                  sourceControlOrgId: sourceControlOrg.id,
                },
              },
            });
            hasTokens = !!sourceControlToken;

            // Check repository access if we have tokens and installation ID
            if (hasTokens && sourceControlOrg?.githubInstallationId) {
              console.log("[STATUS ROUTE] Checking repository access (workspace not linked):", {
                userId: session.user.id,
                installationId: sourceControlOrg.githubInstallationId,
                repositoryUrl: repoUrl,
              });
              hasRepoAccess = await checkRepositoryAccess(
                session.user.id,
                sourceControlOrg.githubInstallationId.toString(),
                repoUrl,
              );
              console.log("[STATUS ROUTE] Repository access result (workspace not linked):", hasRepoAccess);
            }
          } else {
            // SourceControlOrg doesn't exist yet - user needs to go through OAuth
            hasTokens = false;
          }
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

    console.log("[STATUS ROUTE] Final response:", { hasTokens, hasRepoAccess });
    return NextResponse.json({ hasTokens, hasRepoAccess }, { status: 200 });
  } catch (error) {
    console.error("Failed to check GitHub App status", error);
    return NextResponse.json({ hasTokens: false, hasRepoAccess: false }, { status: 200 });
  }
}
