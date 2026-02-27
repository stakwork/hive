import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getWorkspaceBySlug } from "@/services/workspace";
import { isDevelopmentMode } from "@/lib/runtime";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    const { slug } = await params;

    if (!session?.user) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ success: false, message: "Invalid user session" }, { status: 401 });
    }

    const isSuperAdmin = session.user?.isSuperAdmin ?? false;
    const workspace = await getWorkspaceBySlug(slug, userId, { isSuperAdmin });
    if (!workspace) {
      return NextResponse.json({ success: false, message: "Workspace not found or access denied" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const nodeType = searchParams.get("node_type");
    const output = searchParams.get("output") || "json";
    const limit = searchParams.get("limit");

    if (!nodeType) {
      return NextResponse.json({ success: false, message: "node_type is required" }, { status: 400 });
    }

    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }

    const devMode = isDevelopmentMode();

    let graphUrl = "";
    let apiKey = "";

    if (
      devMode ||
      (workspace.id === process.env.STAKWORK_WORKSPACE_ID &&
        process.env.STAKWORK_GRAPH_URL &&
        process.env.STAKWORK_GRAPH_API_KEY)
    ) {
      graphUrl = process.env.STAKWORK_GRAPH_URL ?? graphUrl;
      apiKey = process.env.STAKWORK_GRAPH_API_KEY ?? apiKey;
    } else {
      if (!swarm.swarmUrl || !swarm.swarmApiKey) {
        return NextResponse.json({ success: false, message: "Swarm not configured" }, { status: 400 });
      }

      const swarmUrlObj = new URL(swarm.swarmUrl);
      const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";

      graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;
      apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
    }

    const apiParams = new URLSearchParams({
      node_type: nodeType,
      output: output,
    });

    if (limit) {
      apiParams.set("limit", limit);
    }

    const apiResult = await fetch(`${graphUrl}/nodes?${apiParams.toString()}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
    });

    if (!apiResult.ok) {
      const errorData = await apiResult.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, message: "Failed to fetch nodes", details: errorData },
        { status: apiResult.status },
      );
    }

    const data = await apiResult.json();
    const nodes = Array.isArray(data) ? data : [];

    return NextResponse.json({ success: true, data: { nodes } }, { status: 200 });
  } catch (error) {
    console.error("[Nodes] GET error:", error);
    return NextResponse.json({ success: false, message: "Failed to fetch nodes" }, { status: 500 });
  }
}
