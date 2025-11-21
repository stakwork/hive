import { authOptions } from "@/lib/auth/nextauth";
import { checkRepositoryAccess, getUserAppTokens } from "@/lib/githubApp";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
// import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const startTime = Date.now();

  // Create log context for this request
  const logContext = {
    timestamp: new Date().toISOString(),
    sessionId: Math.random().toString(36).substring(7),
    endpoint: "/api/github/app/status",
    ip: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
    userAgent: request.headers.get("user-agent"),
  };

  console.log("[github-app-status] Request initiated", logContext);

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      console.log("[github-app-status] No authenticated user", {
        ...logContext,
        hasSession: !!session,
        responseTime: Date.now() - startTime,
      });
      return NextResponse.json({ hasTokens: false, hasRepoAccess: false }, { status: 200 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspaceSlug");
    const repositoryUrl = searchParams.get("repositoryUrl");

    const requestLogContext = {
      ...logContext,
      userId: session.user.id,
      workspaceSlug,
      repositoryUrl,
    };

    console.log("[github-app-status] Processing authenticated request", requestLogContext);

    // Validate workspace access if workspaceSlug is provided
    if (workspaceSlug) {
      console.log("[github-app-status] Validating workspace access", {
        ...requestLogContext,
        action: "validate_workspace",
      });

      const workspaceAccess = await validateWorkspaceAccess(workspaceSlug, session.user.id);
      if (!workspaceAccess.hasAccess) {
        console.warn("[github-app-status] Workspace access denied", {
          ...requestLogContext,
          workspaceExists: workspaceAccess.workspace !== null,
          responseTime: Date.now() - startTime,
        });
        return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
      }

      console.log("[github-app-status] Workspace access validated", {
        ...requestLogContext,
        workspaceId: workspaceAccess.workspace?.id,
      });
    }

    let hasTokens = false;
    let hasRepoAccess = false;

    if (workspaceSlug) {
      // Check if user has tokens for this specific workspace's GitHub org
      const { db } = await import("@/lib/db");

      console.log("[github-app-status] Fetching workspace data", {
        ...requestLogContext,
        action: "fetch_workspace",
      });

      // Get workspace
      const workspace = await db.workspace.findUnique({
        where: { slug: workspaceSlug },
        include: {
          sourceControlOrg: true,
        },
      });

      console.log("[github-app-status] Workspace data retrieved", {
        ...requestLogContext,
        hasWorkspace: !!workspace,
        hasSourceControlOrg: !!workspace?.sourceControlOrg,
        sourceControlOrgId: workspace?.sourceControlOrg?.id,
        githubLogin: workspace?.sourceControlOrg?.githubLogin,
        installationId: workspace?.sourceControlOrg?.githubInstallationId,
      });

      if (workspace?.sourceControlOrg) {
        // Workspace is linked to a SourceControlOrg - check if user has tokens for it
        console.log("[github-app-status] Checking source control tokens", {
          ...requestLogContext,
          action: "check_tokens",
          sourceControlOrgId: workspace.sourceControlOrg.id,
        });

        const sourceControlToken = await db.sourceControlToken.findUnique({
          where: {
            userId_sourceControlOrgId: {
              userId: session.user.id,
              sourceControlOrgId: workspace.sourceControlOrg.id,
            },
          },
        });
        hasTokens = !!sourceControlToken;

        console.log("[github-app-status] Source control token check result", {
          ...requestLogContext,
          hasTokens,
          tokenExists: !!sourceControlToken,
        });

        // Get repository URL
        let repoUrl: string | null = repositoryUrl;
        if (!repoUrl) {
          // Check repositoryDraft first, then fall back to primary repository
          repoUrl = workspace.repositoryDraft;
          if (!repoUrl) {
            const primaryRepo = await getPrimaryRepository(workspace.id);
            repoUrl = primaryRepo?.repositoryUrl ?? null;
          }
        }

        // Check repository access if we have tokens and a repository URL
        if (hasTokens && repoUrl && workspace?.sourceControlOrg?.githubInstallationId) {
          console.log("[github-app-status] Checking repository access", {
            ...requestLogContext,
            action: "check_repo_access",
            installationId: workspace.sourceControlOrg.githubInstallationId,
            repoUrl,
          });

          hasRepoAccess = await checkRepositoryAccess(
            session.user.id,
            workspace.sourceControlOrg.githubInstallationId.toString(),
            repoUrl,
          );

          console.log("[github-app-status] Repository access check completed", {
            ...requestLogContext,
            hasRepoAccess,
            repoUrl,
          });
        } else {
          console.log("[github-app-status] Skipping repository access check", {
            ...requestLogContext,
            action: "skip_repo_access",
            reasons: {
              hasTokens,
              hasRepoUrl: !!repoUrl,
              hasInstallationId: !!workspace?.sourceControlOrg?.githubInstallationId,
            },
            repoUrl,
            installationId: workspace?.sourceControlOrg?.githubInstallationId,
          });
        }
      } else {
        // Workspace not linked yet - extract GitHub org from repo URL and check
        let repoUrl: string | null = repositoryUrl;
        if (!repoUrl && workspace) {
          // Check repositoryDraft first, then fall back to primary repository
          repoUrl = workspace.repositoryDraft;
          if (!repoUrl) {
            const primaryRepo = await getPrimaryRepository(workspace.id);
            repoUrl = primaryRepo?.repositoryUrl ?? null;
          }
        }

        if (!repoUrl) {
          console.warn("[github-app-status] No repository URL found", {
            ...requestLogContext,
            action: "no_repo_url",
            workspaceSlug,
            responseTime: Date.now() - startTime,
          });
          return NextResponse.json({ hasTokens: false }, { status: 200 });
        }

        console.log("[github-app-status] Processing unlinked workspace", {
          ...requestLogContext,
          action: "process_unlinked_workspace",
          repoUrl,
        });
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
              console.log("[github-app-status] Checking repository access for auto-linked workspace", {
                ...requestLogContext,
                action: "check_repo_access_auto_linked",
                installationId: sourceControlOrg.githubInstallationId,
                repoUrl,
                githubOwner,
              });

              hasRepoAccess = await checkRepositoryAccess(
                session.user.id,
                sourceControlOrg.githubInstallationId.toString(),
                repoUrl,
              );

              console.log("[github-app-status] Repository access result for auto-linked workspace", {
                ...requestLogContext,
                hasRepoAccess,
                githubOwner,
              });
            }
          } else {
            // SourceControlOrg doesn't exist yet - user needs to go through OAuth
            hasTokens = false;
          }
        }
      }
    } else {
      // No workspace specified - check if user has ANY GitHub App tokens
      console.log("[github-app-status] Checking user app tokens (no workspace)", {
        ...requestLogContext,
        action: "check_user_app_tokens",
      });

      const apptokens = await getUserAppTokens(session.user.id);
      hasTokens = !!apptokens?.accessToken;

      console.log("[github-app-status] User app tokens check result", {
        ...requestLogContext,
        hasTokens,
        hasAppTokens: !!apptokens,
      });
    }

    // if (hasTokens) {
    //   const encryptionService = EncryptionService.getInstance();
    //   const accessToken = encryptionService.decryptField("app_access_token", apptokens.accessToken as string);
    //   console.log("=> accessToken", accessToken);
    // }

    const responseTime = Date.now() - startTime;

    console.log("[github-app-status] Request completed successfully", {
      ...requestLogContext,
      hasTokens,
      hasRepoAccess,
      responseTime,
      status: "success",
    });

    return NextResponse.json({ hasTokens, hasRepoAccess }, { status: 200 });
  } catch (error) {
    const responseTime = Date.now() - startTime;

    console.error("[github-app-status] Request failed", {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      responseTime,
      status: "error",
    });

    return NextResponse.json({ hasTokens: false, hasRepoAccess: false }, { status: 200 });
  }
}
