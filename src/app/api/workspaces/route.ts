import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  createWorkspace,
  ensureUniqueSlug,
  extractRepoNameFromUrl,
  getUserWorkspaces,
  softDeleteWorkspace,
} from "@/services/workspace";
import { runWorkspaceSetup } from "@/services/workspace-setup";
import { findUserByGitHubUsername } from "@/lib/helpers/workspace-member-queries";
import { db } from "@/lib/db";
import { getErrorMessage } from "@/lib/utils/error";

// Prevent caching of user-specific data
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const workspaces = await getUserWorkspaces(userId);
  return NextResponse.json({ workspaces }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const apiToken = request.headers.get("x-api-token");
  const body = await request.json();
  let ownerId: string;

  if (apiToken) {
    if (apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!body.githubUsername) {
      return NextResponse.json(
        { error: "githubUsername required for API key auth" },
        { status: 400 },
      );
    }
    const githubAuth = await findUserByGitHubUsername(body.githubUsername);
    if (!githubAuth) {
      return NextResponse.json(
        { error: "User not found. They must sign up to Hive first." },
        { status: 404 },
      );
    }
    ownerId = githubAuth.userId;
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as { id?: string }).id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    ownerId = (session.user as { id: string }).id;
  }

  const { name, description, slug, repositoryUrl, autoSetup } = body;
  let finalName = name;
  let finalSlug = slug;

  // Auto-generate from repositoryUrl if not provided
  if (repositoryUrl && (!finalSlug || !finalName)) {
    const repoName = extractRepoNameFromUrl(repositoryUrl);
    if (!repoName) {
      return NextResponse.json({ error: "Invalid repository URL" }, { status: 400 });
    }
    if (!finalSlug) {
      finalSlug = await ensureUniqueSlug(repoName);
    }
    if (!finalName) {
      finalName = repoName.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    }
  }

  if (!finalName || !finalSlug) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const workspace = await createWorkspace({
      name: finalName,
      description,
      slug: finalSlug,
      ownerId,
      repositoryUrl,
    });

    if (autoSetup === true && workspace?.id) {
      runWorkspaceSetup(workspace.id, ownerId).catch((err) => {
        console.error("[workspace-setup] Fire-and-forget error:", err);
      });
    }

    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Failed to create workspace.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  // Find the workspace owned by this user
  const workspace = await db.workspace.findFirst({
    where: { ownerId: userId, deleted: false },
  });
  if (!workspace) {
    return NextResponse.json(
      { error: "No workspace found for user" },
      { status: 404 },
    );
  }
  await softDeleteWorkspace(workspace.id);
  return NextResponse.json({ success: true }, { status: 200 });
}
