import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { serviceConfigs } from "@/config/services";
import { getUserAppTokens } from "@/lib/githubApp";
import { findUserInstallationFor } from "@/lib/github/user-installations";
import { signGithubAppState } from "@/lib/auth/github-app-state";
import { validateWorkspaceAccess } from "@/services/workspace";
import { randomBytes } from "crypto";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** Whether `login` is a user or an org, so a fresh install can target the right account. */
async function getOwnerType(token: string, login: string): Promise<"user" | "org" | undefined> {
  try {
    const response = await fetch(`${serviceConfigs.github.baseURL}/users/${login}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (!response.ok) return undefined;
    const data = await response.json();
    return data.type === "User" ? "user" : "org";
  } catch (error) {
    console.error(`Error checking owner type for ${login}:`, error);
    return undefined;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    if (!config.GITHUB_APP_SLUG) {
      return NextResponse.json({ success: false, message: "GitHub App not configured" }, { status: 500 });
    }

    const body = await request.json();
    const workspaceSlug = body?.workspaceSlug;
    const repositoryUrl = body?.repositoryUrl;
    const isExtend = body?.isExtend;

    if (!workspaceSlug) {
      return NextResponse.json({ success: false, message: "Workspace slug is required" }, { status: 400 });
    }

    // IDOR hardening: require the caller to be an ADMIN/OWNER of the
    // workspace before minting any GitHub-App state or leaking the
    // workspace's install metadata (installationId, repositoryUrl, etc).
    // Without this gate any signed-in user could bind a GitHub App
    // installation to a victim workspace by replaying the callback with
    // the state emitted here.
    const access = await validateWorkspaceAccess(workspaceSlug, session.user.id as string);
    if (!access.hasAccess || !access.canAdmin) {
      return NextResponse.json(
        { success: false, message: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // Generate state. The state is signed with NEXTAUTH_SECRET (HMAC-SHA256)
    // so an attacker can't forge a callback against a victim workspace's
    // slug. See `@/lib/auth/github-app-state` for the rationale.
    const randomState = randomBytes(32).toString("hex");
    const state = signGithubAppState({
      workspaceSlug,
      repositoryUrl, // Include repository URL in state for callback
      randomState,
      timestamp: Date.now(),
      userId: session.user.id as string,
    });

    // Legacy binding for callbacks that predate `userId` in the state (only
    // users with a pre-JWT DB session row have one to update).
    await db.session.updateMany({
      where: { userId: session.user.id as string },
      data: { githubState: state },
    });

    // Get workspace
    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      include: {
        sourceControlOrg: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, message: "Workspace not found" },
        { status: 404 },
      );
    }

    // Get repository URL from parameter or primary repository
    let repoUrl = repositoryUrl;
    if (!repoUrl) {
      const { getPrimaryRepository } = await import("@/lib/helpers/repository");
      // Check repositoryDraft first, then fall back to primary repository
      repoUrl = workspace.repositoryDraft;
      if (!repoUrl) {
        const primaryRepo = await getPrimaryRepository(workspace.id);
        repoUrl = primaryRepo?.repositoryUrl ?? null;
      }
    }

    if (!repoUrl) {
      return NextResponse.json(
        { success: false, message: "No repository URL found for this workspace" },
        { status: 400 },
      );
    }
    const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)/);

    if (!githubMatch) {
      return NextResponse.json({ success: false, message: "Invalid GitHub repository URL" }, { status: 400 });
    }

    const githubOwner = githubMatch[1];
    console.log(`🔍 Checking GitHub app installation for owner: ${githubOwner}`);

    // Use the new installation check logic
    let installed = false;
    let installationId: number | undefined;
    let ownerType: "user" | "org" | undefined;

    // First, check if we have a SourceControlOrg record for this GitHub owner
    // This tells us if ANY user has installed the app for this org/user
    const existingSourceControlOrg = await db.sourceControlOrg.findUnique({
      where: { githubLogin: githubOwner },
    });

    console.log('existingSourceControlOrg--existingSourceControlOrg')
    console.log(existingSourceControlOrg)
    console.log('existingSourceControlOrg--existingSourceControlOrg')

    if (existingSourceControlOrg?.githubInstallationId) {
      // App is already installed by some user
      installed = true;
      installationId = existingSourceControlOrg.githubInstallationId;
      ownerType = existingSourceControlOrg.type === "USER" ? "user" : "org";
      console.log(`✅ App already installed on ${githubOwner}! Installation ID: ${installationId} (from database)`);
    } else {
      // No installation record — ask GitHub with any app token this user
      // holds (the org's own token can't exist without that record). The
      // app may be installed outside Hive's flow; then the user only needs
      // to authorize, and the callback finds the installation by owner.
      const appTokens = (await getUserAppTokens(session.user.id, githubOwner)) ?? (await getUserAppTokens(session.user.id));
      if (appTokens?.accessToken) {
        const installation = await findUserInstallationFor(appTokens.accessToken, githubOwner);
        if (installation) {
          installed = true;
          installationId = installation.id;
          ownerType = installation.account.type === "User" ? "user" : "org";
          console.log(`✅ App installed on ${githubOwner}! Installation ID: ${installationId} (from API)`);
        } else {
          console.log(`❌ No installation on ${githubOwner} visible to this user`);
          ownerType = await getOwnerType(appTokens.accessToken, githubOwner);
        }
      } else {
        // This is a new user with no tokens yet, but that doesn't mean the app isn't installed
        // We just couldn't verify it. For safety, we'll assume it needs installation
        console.log(`👤 User has no app tokens for ${githubOwner}, cannot verify installation status`);
      }
    }

    let authUrl: string;
    let flowType: string;

    // If isExtend is true, return URL to extend existing installation
    if (isExtend && installed && installationId) {
      authUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/${installationId}`;
      flowType = "extend_installation";
    } else if (installed) {
      // App already installed - just need user authorization
      authUrl = `https://github.com/login/oauth/authorize?client_id=${config.GITHUB_APP_CLIENT_ID}&state=${state}`;
      flowType = "user_authorization";
    } else {
      console.log(`👤 App not installed for ${githubOwner}`);
      // App not installed - need full installation flow
      if (ownerType === "user") {
        // For user repos, force installation on user account
        authUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${state}&target_type=User`;
      } else {
        // For org repos, let user choose context
        authUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${state}`;
      }
      flowType = "installation";
    }

    console.log("=> authUrl:", authUrl, "flowType:", flowType);

    return NextResponse.json(
      {
        success: true,
        data: {
          link: authUrl,
          state,
          flowType, // So frontend knows what's happening
          appInstalled: installed,
          githubOwner, // Which org/user we're connecting to
          ownerType, // 'user' or 'org'
          installationId, // Installation ID if already installed
          repositoryUrl: repoUrl, // The repository URL from workspace
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to generate GitHub App link", error);
    return NextResponse.json({ success: false, message: "Failed to generate GitHub link" }, { status: 500 });
  }
}
