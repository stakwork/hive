import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { poolManagerService } from "@/lib/service-factory";
import { type ApiError } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { name } = body;

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 },
      );
    }

    // Verify user has access to the swarm/pool by checking workspace membership
    const swarm = await db.swarm.findFirst({
      where: { id: name },
      include: {
        workspace: {
          select: {
            id: true,
            ownerId: true,
            members: {
              where: { userId },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!swarm) {
      return NextResponse.json(
        { error: "Pool not found" },
        { status: 404 },
      );
    }

    // Check if user has access to the workspace
    if (!swarm.workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    const isOwner = swarm.workspace.ownerId === userId;
    const isMember = swarm.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      );
    }

    const pool = await poolManagerService().getPool({ name });

    return NextResponse.json({ pool }, { status: 201 });
  } catch (error) {
    console.error("Error getting Pool Manager pool:", error);

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json({ error: "Failed to get pool" }, { status: 500 });
  }
}
