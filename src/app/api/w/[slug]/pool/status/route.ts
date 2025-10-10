import { NextResponse } from "next/server";
import { notFoundError, validationError, serverError } from "@/types/errors";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getServiceConfig } from "@/config/services";
import { PoolManagerService } from "@/services/pool-manager";

import type { NextRequestWithContext } from "@/types/middleware";
import type { ApiError } from "@/types/errors";

export async function GET(request: NextRequestWithContext, context: { params: { slug: string } }) {
  const { params } = context;
  try {
    // Use middleware context for user info
    const userId = request.middlewareContext?.user?.id;
    const { slug } = params;

    if (!userId) {
      throw serverError("User context missing in middleware");
    }
    if (!slug) {
      throw validationError("Workspace slug is required");
    }

    const workspace = await getWorkspaceBySlug(slug, userId);
    if (!workspace) {
      throw notFoundError("Workspace not found or access denied");
    }

    const { db } = await import("@/lib/db");
    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspace.id },
      select: { id: true, poolApiKey: true },
    });
    if (!swarm?.id || !swarm?.poolApiKey) {
      throw notFoundError("Pool not configured for this workspace");
    }

    const config = getServiceConfig("poolManager");
    const poolManagerService = new PoolManagerService(config);
    const poolStatus = await poolManagerService.getPoolStatus(swarm.id, swarm.poolApiKey);
    return NextResponse.json({ success: true, data: poolStatus });
  } catch (error) {
    if (error && typeof error === "object" && "kind" in error && "statusCode" in error) {
      const err = error as ApiError;
      return NextResponse.json(
        { error: err.message, kind: err.kind, details: err.details },
        { status: err.statusCode },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
