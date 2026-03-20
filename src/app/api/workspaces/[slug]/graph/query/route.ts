import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const WRITE_KEYWORDS_RE = /\b(CREATE|MERGE|SET|DELETE|REMOVE|DROP)\b/i;

export async function POST(
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

    // Validate workspace access
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

    // Parse request body
    const body = await request.json();
    const { query, limit } = body as { query?: string; limit?: number };

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { success: false, message: "query is required" },
        { status: 400 },
      );
    }

    // Read-only guard — block write keywords
    if (WRITE_KEYWORDS_RE.test(query)) {
      return NextResponse.json(
        { success: false, message: "Write operations are not permitted" },
        { status: 403 },
      );
    }

    // Mock fallback
    if (process.env.USE_MOCKS === "true") {
      if (process.env.NODE_ENV === "test") {
        const { POST: MockPOST } = await import(
          "@/app/api/mock/graph/query/route"
        );
        return await MockPOST();
      }
      const mockUrl = new URL(
        "/api/mock/graph/query",
        request.nextUrl.origin,
      );
      const mockRes = await fetch(mockUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit }),
      });
      const mockData = await mockRes.json();
      return NextResponse.json(mockData, { status: mockRes.status });
    }

    // Resolve workspace to get swarm
    const workspace = await db.workspaces.findFirst({
      where: { slug, deleted: false },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, message: "Workspace not found" },
        { status: 404 },
      );
    }

    const swarm = await db.swarms.findUnique({
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

    // Extract hostname and construct graph URL (port 3355)
    const swarmUrlObj = new URL(swarm.swarmUrl);
    const protocol = swarmUrlObj.hostname.includes("localhost")
      ? "http"
      : "https";

    let graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;
    let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    if (process.env.CUSTOM_SWARM_URL) {
      graphUrl = `${process.env.CUSTOM_SWARM_URL}:3355`;
    }
    if (process.env.CUSTOM_SWARM_API_KEY) {
      apiKey = process.env.CUSTOM_SWARM_API_KEY;
    }

    // Forward to ArcadeDB
    const apiResult = await fetch(`${graphUrl}/api/hive/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
      body: JSON.stringify({
        language: "cypher",
        query,
        limit: limit ?? 100,
      }),
    });

    if (!apiResult.ok) {
      const data = await apiResult.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, message: "Query failed", details: data },
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
