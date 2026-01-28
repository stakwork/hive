import { NextRequest, NextResponse } from "next/server";
import { requireAuthFromRequest } from "@/lib/api/auth-helpers";
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
    const { error, userId } = requireAuthFromRequest(req);
    if (error) return error;

    const { slug } = await params;

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
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { error, userId } = requireAuthFromRequest(req);
    if (error) return error;

    const { slug } = await params;

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
