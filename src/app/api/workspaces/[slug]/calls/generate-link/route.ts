import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    // Get workspace with swarm info
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      include: {
        swarm: {
          select: {
            name: true,
            status: true,
          },
        },
        members: {
          where: {
            userId: userOrResponse.id,
            leftAt: null,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    // Check user has access (owner or member)
    if (workspace.ownerId !== userOrResponse.id && workspace.members.length === 0) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      );
    }

    // Validate swarm exists and is active
    if (!workspace.swarm || workspace.swarm.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Swarm not configured or not active" },
        { status: 400 },
      );
    }

    if (!workspace.swarm.name || workspace.swarm.name.trim() === "") {
      return NextResponse.json(
        { error: "Swarm name not found" },
        { status: 400 },
      );
    }

    // Get LiveKit base URL from environment
    const liveKitBaseUrl = optionalEnvVars.LIVEKIT_CALL_BASE_URL;
    if (!liveKitBaseUrl) {
      return NextResponse.json(
        { error: "LiveKit call service not configured" },
        { status: 500 },
      );
    }

    // Generate call URL
    const timestamp = Math.floor(Date.now() / 1000);
    const callUrl = `${liveKitBaseUrl}${workspace.swarm.name}.sphinx.chat-.${timestamp}`;

    return NextResponse.json({ url: callUrl });
  } catch (error) {
    console.error("Error generating call link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
