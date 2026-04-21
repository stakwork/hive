import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { poolManagerService } from "@/lib/service-factory";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { type ApiError } from "@/types";

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || !(session.user as { id?: string }).id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id: string }).id;

    let body;
    try {
      body = await request.json();
    } catch {
      // Handle empty body or malformed JSON
      body = {};
    }

    const { name } = body;

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 },
      );
    }

    // `name` is the swarm.id (matches pool_name convention in create-pool).
    // Resolve the owning workspace and require workspace admin before
    // allowing a pool deletion — otherwise any signed-in user can DoS
    // any workspace's compute pool (IDOR hardening).
    const swarm = await db.swarm.findUnique({
      where: { id: name },
      select: { workspaceId: true },
    });

    if (!swarm) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    const access = await validateWorkspaceAccessById(swarm.workspaceId, userId);
    if (!access.hasAccess || !access.canAdmin) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    const pool = await poolManagerService().deletePool({ name });

    return NextResponse.json({ pool }, { status: 201 });
  } catch (error) {
    console.error("Error deleting Pool Manager pool:", error);

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

    return NextResponse.json(
      { error: "Failed to delete pool" },
      { status: 500 },
    );
  }
}
