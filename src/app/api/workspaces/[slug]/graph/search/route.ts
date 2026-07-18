import { authOptions } from "@/lib/auth/nextauth";
import { getSwarmVanityAddress } from "@/lib/constants";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getStakgraphUrl } from "@/lib/utils/stakgraph-url";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Invalid user session" },
        { status: 401 },
      );
    }

    // Validate workspace access (IDOR guard — must happen before resolving swarm)
    const access = await validateWorkspaceAccess(slug, userId, true);
    if (!access.hasAccess) {
      return NextResponse.json(
        { success: false, message: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // Role gate — admins and owners only
    if (!access.canAdmin) {
      return NextResponse.json(
        { success: false, message: "Forbidden: admin access required" },
        { status: 403 },
      );
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("query");
    const nodeTypes = searchParams.get("node_types") ?? "";
    const method = searchParams.get("method") ?? "hybrid";
    const limit = searchParams.get("limit") ?? "25";

    if (!query) {
      return NextResponse.json(
        { success: false, message: "query is required" },
        { status: 400 },
      );
    }

    // Mock fallback
    if (process.env.USE_MOCKS === "true") {
      if (process.env.NODE_ENV === "test") {
        const { GET: MockGET } = await import(
          "@/app/api/mock/graph/search/route"
        );
        return await MockGET();
      }
      const mockUrl = new URL("/api/mock/graph/search", request.nextUrl.origin);
      const mockRes = await fetch(mockUrl.toString());
      const mockData = await mockRes.json();
      return NextResponse.json(mockData, { status: mockRes.status });
    }

    // Resolve workspace to get swarm
    const workspace = await db.workspace.findFirst({
      where: { slug, deleted: false },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, message: "Workspace not found" },
        { status: 404 },
      );
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!swarm) {
      return NextResponse.json(
        { success: false, message: "Graph DB not configured for this workspace" },
        { status: 400 },
      );
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Graph DB not configured for this workspace" },
        { status: 400 },
      );
    }

    const encryptionService = EncryptionService.getInstance();
    let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    if (process.env.CUSTOM_SWARM_API_KEY) {
      apiKey = process.env.CUSTOM_SWARM_API_KEY;
    }

    const stakgraphUrl = getStakgraphUrl(getSwarmVanityAddress(swarm.name));

    // Build forward URL
    const forwardUrl = new URL(`${stakgraphUrl}/search`);
    forwardUrl.searchParams.set("query", query);
    if (nodeTypes) forwardUrl.searchParams.set("node_types", nodeTypes);
    forwardUrl.searchParams.set("method", method);
    forwardUrl.searchParams.set("limit", limit);
    forwardUrl.searchParams.set("output", "json");
    forwardUrl.searchParams.set("concise", "true");

    const apiResult = await fetch(forwardUrl.toString(), {
      method: "GET",
      headers: {
        "x-api-token": apiKey,
      },
    });

    if (!apiResult.ok) {
      const data = await apiResult.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, message: "Search failed", details: data },
        { status: apiResult.status },
      );
    }

    const data = await apiResult.json();
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
