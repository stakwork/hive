import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { RecentChatItem } from "@/types/shared-conversation";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

// GET /api/workspaces/[slug]/chat/recent?limit=10
// Returns workspace-wide recent dashboard conversations (all users), ordered by lastMessageAt desc
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as { id?: string }).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;
  const { slug } = await params;

  try {
    // Validate workspace access
    const access = await validateWorkspaceAccess(slug, userId, true);
    if (!access.hasAccess) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 403 }
      );
    }

    // Get workspace ID
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      select: {
        id: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Parse limit param (max 10)
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 10);

    // Query workspace-wide dashboard conversations, no userId filter
    const conversations = await db.sharedConversation.findMany({
      where: {
        workspaceId: workspace.id,
        source: "dashboard",
      },
      orderBy: {
        lastMessageAt: "desc",
      },
      take: limit,
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        source: true,
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const items: RecentChatItem[] = conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      lastMessageAt: conv.lastMessageAt?.toISOString() || null,
      creatorName: conv.user.name,
      creatorId: conv.user.id,
      source: conv.source,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to fetch recent chats:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent chats" },
      { status: 500 }
    );
  }
}
