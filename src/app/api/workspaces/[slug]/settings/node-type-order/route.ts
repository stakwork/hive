import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { z } from "zod";

const nodeTypeConfigSchema = z.object({
  nodeTypeOrder: z.array(z.object({
    type: z.string(),
    value: z.number().min(0).max(999),
  })),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const userId = (session.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "User ID not found" }, { status: 401 });
    }

    // Parse request body
    const body = await req.json();
    const parseResult = nodeTypeConfigSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { nodeTypeOrder } = parseResult.data;

    // Check if user has admin access to the workspace
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
                role: { in: ["ADMIN", "OWNER"] },
                leftAt: null,
              },
            },
          },
        ],
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    // Update the workspace with the new node type order
    const updatedWorkspace = await db.workspace.update({
      where: { id: workspace.id },
      data: {
        nodeTypeOrder: nodeTypeOrder,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        slug: true,
        nodeTypeOrder: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        nodeTypeOrder: updatedWorkspace.nodeTypeOrder,
      },
    });
  } catch (error) {
    console.error("Error updating node type order:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const userId = (session.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "User ID not found" }, { status: 401 });
    }

    // Check if user has access to the workspace
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
                leftAt: null,
              },
            },
          },
        ],
      },
      select: {
        id: true,
        slug: true,
        nodeTypeOrder: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        nodeTypeOrder: workspace.nodeTypeOrder || [],
      },
    });
  } catch (error) {
    console.error("Error fetching node type order:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
