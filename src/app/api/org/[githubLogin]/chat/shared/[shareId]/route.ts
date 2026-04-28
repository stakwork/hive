import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

/**
 * GET a single org-scoped shared conversation. Mirrors the
 * workspace-scoped variant at
 * `/api/workspaces/[slug]/chat/shared/[shareId]/route.ts` but auths
 * via `SourceControlToken` against the org instead of workspace
 * membership.
 *
 * Used by the org canvas page to client-side preload a conversation
 * when the URL has `?chat=<shareId>`. The standalone server-rendered
 * viewer page at `/org/[githubLogin]/chat/shared/[shareId]/page.tsx`
 * fetches directly from Prisma; this route exposes the same data to
 * the client.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ githubLogin: string; shareId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { githubLogin, shareId } = await params;

  try {
    // Look up the org
    const org = await db.sourceControlOrg.findFirst({
      where: { githubLogin },
    });

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    // Verify caller has access to this org via SourceControlToken,
    // matching the share POST's auth check.
    const token = await db.sourceControlToken.findFirst({
      where: { userId, sourceControlOrgId: org.id },
    });

    if (!token) {
      return NextResponse.json(
        { error: "Access denied. You must be an organization member." },
        { status: 403 },
      );
    }

    const sharedConversation = await db.sharedConversation.findUnique({
      where: { id: shareId },
      select: {
        id: true,
        sourceControlOrgId: true,
        title: true,
        messages: true,
      },
    });

    if (!sharedConversation) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 },
      );
    }

    // Verify the row belongs to this org. Return 404 (not 403) to
    // avoid leaking the existence of conversations in other orgs.
    if (sharedConversation.sourceControlOrgId !== org.id) {
      return NextResponse.json(
        { error: "Shared conversation not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        id: sharedConversation.id,
        title: sharedConversation.title,
        messages: sharedConversation.messages,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to fetch org shared conversation:", error);
    return NextResponse.json(
      { error: "Failed to fetch shared conversation" },
      { status: 500 },
    );
  }
}
