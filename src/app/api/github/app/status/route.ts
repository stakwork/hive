import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { NextRequest, NextResponse } from "next/server";
import { getPrimaryRepository } from "@/lib/helpers/repository";
// import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) {
      return NextResponse.json({ hasTokens: false, hasRepoAccess: false }, { status: 200 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspaceSlug");
    const repositoryUrl = searchParams.get("repositoryUrl");

    // Validate workspace access if workspaceSlug is provided
    if (workspaceSlug) {
      const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, userOrResponse.id);
      if (!workspaceAccess.hasAccess) {
        return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
      }
    }

    let hasTokens = false;
    let hasRepoAccess = false;

    if (workspaceSlug) {
      // Check if user has tokens for this specific workspace's GitHub org
      const { db } = await import("@/lib/db");

      // Get workspace
      const workspace = await db.workspace.findUnique({
        where: { slug: workspaceSlug },
        include: {
          sourceControlOrg: true,
        },
      });

      if (workspace?.sourceControlOrg) {
        // Workspace is linked to a SourceControlOrg - check if user has tokens for it
        const sourceControlToken = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: userOrResponse.id,
              sourceControlOrgId: workspace.sourceControlOrg.id,
            },
          },
        });
        hasTokens = !!sourceControlToken;

        // Get repository URL
        let repoUrl: string | null = repositoryUrl;
        if (!repoUrl) {
          const primaryRepo = await getPrimaryRepository(workspace.id);
          repoUrl = primaryRepo?.repositoryUrl ?? null;
        }

        // Check repository access if we have tokens and a repository URL
        if (hasTokens && repoUrl && workspace?.sourceControlOrg?.githubInstallationId) {
          console.log("[STATUS ROUTE] Checking repository access:", {
            userId: userOrResponse.id,
            installationId: workspace.sourceControlOrg.githubInstallationId,
            repositoryUrl: repoUrl,
          });
          hasRepoAccess = await checkRepositoryAccess(
            userOrResponse.id,
            workspace.sourceControlOrg.githubInstallationId.toString(),
            repoUrl,
          );
          console.log("[STATUS ROUTE] Repository access result:", hasRepoAccess);
        } else {
          console.log("[STATUS ROUTE] Skipping repository access check:", {
            hasTokens,
            hasRepoUrl: !!repoUrl,
            hasInstallationId: !!workspace?.sourceControlOrg?.githubInstallationId,
            repositoryUrl: repoUrl,
            installationId: workspace?.sourceControlOrg?.githubInstallationId,
          });
        }
      } else {
        // Workspace not linked yet - extract GitHub org from repo URL and check
        let repoUrl: string | null = repositoryUrl;
        if (!repoUrl && workspace) {
          const primaryRepo = await getPrimaryRepository(workspace.id);
          repoUrl = primaryRepo?.repositoryUrl ?? null;
        }

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
                  userId: userOrResponse.id,
                  sourceControlOrgId: sourceControlOrg.id,
                },
              },
            });
            hasTokens = !!sourceControlToken;

            // Check repository access if we have tokens and installation ID
            if (hasTokens && sourceControlOrg?.githubInstallationId) {
              console.log("[STATUS ROUTE] Checking repository access (workspace not linked):", {
                userId: userOrResponse.id,
                installationId: sourceControlOrg.githubInstallationId,
                repositoryUrl: repoUrl,
              });
              hasRepoAccess = await checkRepositoryAccess(
                userOrResponse.id,
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
      const apptokens = await getUserAppTokens(userOrResponse.id);
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
