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
    const startRefId = searchParams.get("start_ref_id");
    const endRefId = searchParams.get("end_ref_id");

    if (!startRefId || !endRefId) {
      return NextResponse.json(
        { success: false, message: "start_ref_id and end_ref_id are required" },
        { status: 400 },
      );
    }

    // Mock fallback
    if (process.env.USE_MOCKS === "true") {
      if (process.env.NODE_ENV === "test") {
        const { GET: MockGET } = await import(
          "@/app/api/mock/graph/shortest-path/route"
        );
        return await MockGET();
      }
      const mockUrl = new URL("/api/mock/graph/shortest-path", request.nextUrl.origin);
      const mockRes = await fetch(mockUrl.toString());
      const text = await mockRes.text();
      return new NextResponse(text, {
        status: mockRes.status,
        headers: { "Content-Type": "text/plain" },
      });
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
    const forwardUrl = new URL(`${stakgraphUrl}/shortest_path`);
    forwardUrl.searchParams.set("start_ref_id", startRefId);
    forwardUrl.searchParams.set("end_ref_id", endRefId);

    const apiResult = await fetch(forwardUrl.toString(), {
      method: "GET",
      headers: {
        "x-api-token": apiKey,
      },
    });

    // Response is plain text — do NOT JSON.parse
    const text = await apiResult.text();
    return new NextResponse(text, {
      status: apiResult.status,
      headers: { "Content-Type": "text/plain" },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
