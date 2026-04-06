import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth/nextauth";
import {
  createWorkspace,
  ensureUniqueSlug,
  extractRepoNameFromUrl,
  getUserWorkspaces,
  softDeleteWorkspace,
  validateWorkspaceSlug,
} from "@/services/workspace";
import { WORKSPACE_LIMITS, WORKSPACE_ERRORS } from "@/lib/constants";
import { findUserByGitHubUsername } from "@/lib/helpers/workspace-member-queries";
import { db } from "@/lib/db";
import { getErrorMessage } from "@/lib/utils/error";

// Prevent caching of user-specific data
export const dynamic = "force-dynamic";

/**
 * Helper to get user ID from session cookie or Bearer token.
 *
 * Note: This route is marked as "webhook" in middleware config (to allow external API creation),
 * so we can't use getMiddlewareContext(). Instead we check auth manually here.
 * Supports both session cookies (web UI) and Bearer tokens (Sphinx app).
 */
async function getUserId(request: NextRequest): Promise<string | null> {
  // First try session cookie (web UI)
  const session = await getServerSession(authOptions);
  if (session?.user && (session.user as { id?: string }).id) {
    return (session.user as { id: string }).id;
  }

  // Then try Bearer token (Sphinx app auth)
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET!,
  });
  if (token?.id && typeof token.id === "string") {
    return token.id;
  }

  return null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workspaces = await getUserWorkspaces(userId);
  return NextResponse.json({ workspaces }, { status: 200 });
}

/**
 * Create a graph_mindset workspace atomically with payment claiming.
 *
 * The entire operation — workspace row creation, payment link (CAS), paymentStatus update,
 * and WorkspaceMember creation — runs in a single db.$transaction. The payment CAS uses
 * `updateMany WHERE workspaceId IS NULL`, which returns count=0 if another concurrent
 * transaction already claimed the payment (causing this transaction to throw and roll back
 * the workspace creation too). This guarantees one payment → at most one workspace.
 */
async function createGraphMindsetWorkspace(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  opts: {
    name: string;
    description?: string;
    slug: string;
    ownerId: string;
    repositoryUrl?: string;
  },
) {
  const { name, description, slug, ownerId, repositoryUrl } = opts;

  // Inline the workspace limit + slug-uniqueness checks inside the transaction
  const existingCount = await tx.workspace.count({
    where: { ownerId, deleted: false },
  });
  if (existingCount >= WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER) {
    throw new Error(WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED);
  }

  // Create the workspace row first (will be rolled back if payment CAS fails)
  const workspace = await tx.workspace.create({
    data: {
      name,
      description,
      slug,
      ownerId,
      repositoryDraft: repositoryUrl,
      workspaceKind: "graph_mindset",
    },
  });

  // --- CAS: claim the payment atomically ---
  // Try FiatPayment first (preferred), fall back to LightningPayment.
  // Using updateMany WHERE workspaceId IS NULL is a true compare-and-set:
  // if another concurrent transaction already linked this payment, count will be 0
  // and we throw — rolling back the workspace creation above.
  const fiatClaim = await tx.fiatPayment.findFirst({
    where: { userId: ownerId, status: "PAID", workspaceId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let paymentLinked = false;

  if (fiatClaim) {
    const result = await tx.fiatPayment.updateMany({
      where: { id: fiatClaim.id, workspaceId: null },
      data: { workspaceId: workspace.id },
    });
    paymentLinked = result.count > 0;
  } else {
    const lightningClaim = await tx.lightningPayment.findFirst({
      where: { userId: ownerId, status: "PAID", workspaceId: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (lightningClaim) {
      const result = await tx.lightningPayment.updateMany({
        where: { id: lightningClaim.id, workspaceId: null },
        data: { workspaceId: workspace.id },
      });
      paymentLinked = result.count > 0;
    }
  }

  if (!paymentLinked) {
    // No unlinked PAID payment available — payment was stolen by a concurrent request.
    // Throwing here rolls back the workspace.create above.
    throw new Error("PAYMENT_REQUIRED");
  }

  // Mark workspace as paid and create the owner WorkspaceMember record
  await tx.workspace.update({
    where: { id: workspace.id },
    data: { paymentStatus: "PAID" },
  });

  await tx.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: ownerId } },
    update: {},
    create: { workspaceId: workspace.id, userId: ownerId, role: "OWNER" },
  });

  return {
    ...workspace,
    paymentStatus: "PAID" as const,
    nodeTypeOrder: workspace.nodeTypeOrder as Array<{ type: string; value: number }> | null,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
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

  const { name, description, slug, repositoryUrl, workspaceKind } = body;
  let finalName = name;
  let finalSlug = slug;

  // Auto-generate from repositoryUrl if not provided
  if (repositoryUrl && (!finalSlug || !finalName)) {
    const repoName = extractRepoNameFromUrl(repositoryUrl);
    if (!repoName) {
      return NextResponse.json({ error: "Invalid repository URL" }, { status: 400 });
    }
    if (!finalSlug) {
      finalSlug = repoName;
    }
    if (!finalName) {
      finalName = repoName.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    }
  }

  // Always ensure slug is unique (handles both reserved slugs and duplicates)
  if (finalSlug) {
    finalSlug = await ensureUniqueSlug(finalSlug);
  }

  if (!finalName || !finalSlug) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // graph_mindset path: validate then create atomically with payment claim
  if (workspaceKind === "graph_mindset") {
    // Validate slug format before entering the transaction
    const slugValidation = validateWorkspaceSlug(finalSlug);
    if (!slugValidation.isValid) {
      return NextResponse.json({ error: slugValidation.error }, { status: 400 });
    }

    // repositoryUrl allowlist: validate against ONBOARDING_FORK_REPOS when configured
    if (repositoryUrl) {
      const allowedRepos = (process.env.ONBOARDING_FORK_REPOS || "")
        .split(",")
        .map((r: string) => r.trim())
        .filter(Boolean);
      if (allowedRepos.length > 0 && !allowedRepos.includes(repositoryUrl)) {
        return NextResponse.json({ error: "Invalid repository URL" }, { status: 400 });
      }
    }

    // Fast-fail pre-check: avoids entering a transaction when there is clearly no payment.
    // The real enforcement is the CAS inside the transaction below.
    const hasPaidFiat = await db.fiatPayment.findFirst({
      where: { userId: ownerId, status: "PAID", workspaceId: null },
      select: { id: true },
    });
    if (!hasPaidFiat) {
      const hasPaidLightning = await db.lightningPayment.findFirst({
        where: { userId: ownerId, status: "PAID", workspaceId: null },
        select: { id: true },
      });
      if (!hasPaidLightning) {
        return NextResponse.json({ error: "Payment required" }, { status: 402 });
      }
    }

    try {
      const workspace = await db.$transaction((tx) =>
        createGraphMindsetWorkspace(tx, {
          name: finalName,
          description,
          slug: finalSlug,
          ownerId,
          repositoryUrl,
        }),
      );
      return NextResponse.json({ workspace }, { status: 201 });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "PAYMENT_REQUIRED") {
        return NextResponse.json({ error: "Payment required" }, { status: 402 });
      }
      const message = getErrorMessage(error, "Failed to create workspace.");
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // Non-graph_mindset path: use the standard createWorkspace service
  try {
    const workspace = await createWorkspace({
      name: finalName,
      description,
      slug: finalSlug,
      ownerId,
      repositoryUrl,
      workspaceKind,
    });
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
