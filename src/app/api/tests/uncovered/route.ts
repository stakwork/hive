import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";
import {
  UncoveredItemsResponse,
  UncoveredNodeType,
  UncoveredResponseItem,
  UncoveredResponseRaw,
} from "@/types/stakgraph";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const swarmId = searchParams.get("swarmId");

    if (!workspaceId && !swarmId) {
      return NextResponse.json(
        { success: false, message: "Missing required parameter: workspaceId or swarmId" },
        { status: 400 },
      );
    }

    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;
    const swarm = await db.swarm.findFirst({ where });

    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Uncovered data is not available." }, { status: 400 });
    }

    const swarmUrlObj = new URL(swarm.swarmUrl);
    const stakgraphUrl = `https://${swarmUrlObj.hostname}:7799`;

    const nodeTypeParam = (searchParams.get("node_type") || searchParams.get("nodeType") || "endpoint").toLowerCase();
    if (nodeTypeParam !== "endpoint" && nodeTypeParam !== "function") {
      return NextResponse.json(
        { success: false, message: "Invalid node_type. Use 'endpoint' or 'function'." },
        { status: 400 },
      );
    }
    const nodeType: UncoveredNodeType = nodeTypeParam as UncoveredNodeType;
    const limit = searchParams.get("limit") || "10";
    const offset = searchParams.get("offset") || "0";
    const sort = (searchParams.get("sort") || "usage").toLowerCase();
    const root = searchParams.get("root") || "";
    const concise = (searchParams.get("concise") ?? "true").toString();
    const tests = (searchParams.get("tests") || "all").toLowerCase();

    const query = new URLSearchParams();
    query.set("node_type", nodeType);
    if (limit) query.set("limit", String(limit));
    if (offset) query.set("offset", String(offset));
    if (sort) query.set("sort", String(sort));
    if (root) query.set("root", String(root));
    if (concise) query.set("concise", String(concise));
    if (tests) query.set("tests", tests);
    query.set("output", "json");

    const endpointPath = `/tests/uncovered?${query.toString()}`;

    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: endpointPath,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    if (!apiResult.ok) {
      return NextResponse.json(
        { success: false, message: "Failed to fetch uncovered data", details: apiResult.data },
        { status: apiResult.status },
      );
    }

    const payload = (apiResult.data || {}) as UncoveredResponseRaw;
    const rawItems = nodeType === "endpoint" ? payload.endpoints : payload.functions;
    const items: UncoveredResponseItem[] = Array.isArray(rawItems) ? rawItems : [];

    const response: UncoveredItemsResponse = {
      success: true,
      data: {
        node_type: nodeType,
        limit: Number(limit) || 10,
        offset: Number(offset) || 0,
        items,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching uncovered data:", error);
    return NextResponse.json({ success: false, message: "Failed to fetch uncovered data" }, { status: 500 });
  }
}
