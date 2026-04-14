import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import {
  loadCachedMetrics,
  computeAndCacheMetrics,
} from "@/lib/scorer/metrics";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 }
      );
    }

    const window = searchParams.get("window") || "all";
    const refresh = searchParams.get("refresh") === "true";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

    let since: Date | undefined;
    if (window === "24h") since = new Date(Date.now() - 86400000);
    else if (window === "7d") since = new Date(Date.now() - 604800000);
    else if (window === "30d") since = new Date(Date.now() - 2592000000);

    // Try cache first (only for unfiltered "all" window)
    if (!refresh && !since) {
      const cached = await loadCachedMetrics(workspaceId, page, PAGE_SIZE);
      if (cached) {
        return NextResponse.json({
          aggregate: cached.aggregate,
          features: cached.features,
          pagination: {
            page,
            pageSize: PAGE_SIZE,
            totalFeatures: cached.totalFeatures,
            totalPages: cached.totalPages,
          },
        });
      }
    }

    // Cache miss or filtered: compute fresh and cache
    const result = await computeAndCacheMetrics(workspaceId, since);

    // Paginate the full result
    const totalFeatures = result.features.length;
    const totalPages = Math.max(1, Math.ceil(totalFeatures / PAGE_SIZE));
    const start = (page - 1) * PAGE_SIZE;
    const paginatedFeatures = result.features.slice(start, start + PAGE_SIZE);

    return NextResponse.json({
      aggregate: result.aggregate,
      features: paginatedFeatures,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalFeatures,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error computing scorer metrics:", error);
    return NextResponse.json(
      { error: "Failed to compute metrics" },
      { status: 500 }
    );
  }
}
