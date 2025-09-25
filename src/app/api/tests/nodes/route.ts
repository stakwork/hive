import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import type { CoverageNodeConcise, CoverageNodesResponse, UncoveredNodeType, NodesResponse } from "@/types/stakgraph";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

type ParsedParams = {
  nodeType: UncoveredNodeType;
  limit: string;
  offset: string;
  sort: string;
  root: string;
  concise: string;
};

function parseAndValidateParams(searchParams: URLSearchParams): ParsedParams | { error: NextResponse } {
  const nodeTypeParam = (searchParams.get("node_type") || searchParams.get("nodeType") || "endpoint").toLowerCase();
  if (nodeTypeParam !== "endpoint" && nodeTypeParam !== "function") {
    return {
      error: NextResponse.json(
        { success: false, message: "Invalid node_type. Use 'endpoint' or 'function'." },
        { status: 400 },
      ),
    } as const;
  }
  const nodeType = nodeTypeParam as UncoveredNodeType;
  const limit = searchParams.get("limit") || "10";
  const offset = searchParams.get("offset") || "0";
  const sort = (searchParams.get("sort") || "usage").toLowerCase();
  const root = searchParams.get("root") || "";
  const concise = (searchParams.get("concise") ?? "true").toString();
  return { nodeType, limit, offset, sort, root, concise };
}

function buildQueryString(params: ParsedParams): string {
  const q = new URLSearchParams();
  q.set("node_type", params.nodeType);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  if (params.sort) q.set("sort", String(params.sort));
  if (params.root) q.set("root", String(params.root));
  if (params.concise) q.set("concise", String(params.concise));
  return q.toString();
}

type ItemsOrNodes = { items?: CoverageNodeConcise[]; nodes?: CoverageNodeConcise[] };

function isItemsOrNodes(payload: unknown): payload is ItemsOrNodes {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as ItemsOrNodes;
  return Array.isArray(p.items) || Array.isArray(p.nodes);
}

function isNodesResponse(payload: unknown): payload is NodesResponse {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as NodesResponse;
  return Array.isArray(p.endpoints) || Array.isArray(p.functions);
}

function normalizeResponse(
  payload: unknown,
  nodeType: UncoveredNodeType,
  limit: string,
  offset: string,
): CoverageNodesResponse {
  let items: CoverageNodeConcise[] = [];
  if (isItemsOrNodes(payload)) {
    items = payload.items || payload.nodes || [];
  } else if (isNodesResponse(payload)) {
    const list = nodeType === "endpoint" ? payload.endpoints : payload.functions;
    items = (list as CoverageNodeConcise[]) || [];
  }

  // Ensure default fields exist to avoid undefined in UI
  items = items.map((n) => {
    const src = n as Partial<CoverageNodeConcise>;
    return {
      name: n.name,
      file: n.file,
      weight: typeof n.weight === "number" ? n.weight : 0,
      test_count: typeof src.test_count === "number" ? src.test_count : 0,
      covered: Boolean(n.covered),
    } as CoverageNodeConcise;
  });

  return {
    success: true,
    data: {
      node_type: nodeType,
      limit: Number(limit) || 10,
      offset: Number(offset) || 0,
      items,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams, hostname } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId") || searchParams.get("id");
    const swarmId = searchParams.get("swarmId");

    const parsed = parseAndValidateParams(searchParams);
    if ("error" in parsed) return parsed.error;
    const { nodeType, limit, offset } = parsed;
    const endpointPath = `/tests/nodes?${buildQueryString(parsed)}`;

    const isLocalHost =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
    if (process.env.NODE_ENV === "development" && isLocalHost) {
      const url = `http://0.0.0.0:7799${endpointPath}`;
      const resp = await fetch(url);
      const data = await resp.json().catch(() => ({}));
      if (process.env.NODE_ENV === "development") {
        try {
          console.log("[tests/nodes][DEV] upstream url:", url);
          console.log(
            "[tests/nodes][DEV] upstream raw:",
            typeof data === "object" ? JSON.stringify(data).slice(0, 4000) : String(data),
          );
        } catch {
          // ignore logging errors
        }
      }
      if (!resp.ok) {
        return NextResponse.json(
          { success: false, message: "Failed to fetch coverage nodes (dev)", details: data },
          { status: resp.status },
        );
      }
      const response = normalizeResponse(data as unknown, nodeType, limit, offset);
      if (process.env.NODE_ENV === "development") {
        try {
          console.log("[tests/nodes][DEV] normalized:", JSON.stringify(response).slice(0, 4000));
        } catch {}
      }
      return NextResponse.json(response, { status: 200 });
    }

    if (!workspaceId && !swarmId) {
      return NextResponse.json(
        { success: false, message: "Missing required parameter: workspaceId or swarmId" },
        { status: 400 },
      );
    }

    if (workspaceId) {
      const workspaceAccess = await validateWorkspaceAccessById(workspaceId, session.user.id);
      if (!workspaceAccess.hasAccess) {
        return NextResponse.json({ success: false, message: "Workspace not found or access denied" }, { status: 403 });
      }
    }

    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;
    const swarm = await db.swarm.findFirst({ where });

    if (!swarm) {
      return NextResponse.json({ success: false, message: "Swarm not found" }, { status: 404 });
    }
    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json({ success: false, message: "Coverage data is not available." }, { status: 400 });
    }

    const swarmUrlObj = new URL(swarm.swarmUrl);
    const stakgraphUrl = `https://${swarmUrlObj.hostname}:7799`;

    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint: endpointPath,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    if (!apiResult.ok) {
      return NextResponse.json(
        { success: false, message: "Failed to fetch coverage nodes", details: apiResult.data },
        { status: apiResult.status },
      );
    }
    if (process.env.NODE_ENV === "development") {
      try {
        console.log("[tests/nodes] upstream path:", endpointPath);
        console.log(
          "[tests/nodes] upstream raw:",
          typeof apiResult.data === "object" ? JSON.stringify(apiResult.data).slice(0, 4000) : String(apiResult.data),
        );
      } catch {}
    }

    const response = normalizeResponse(apiResult.data as unknown, nodeType, limit, offset);
    if (process.env.NODE_ENV === "development") {
      try {
        console.log("[tests/nodes] normalized:", JSON.stringify(response).slice(0, 4000));
      } catch {}
    }
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching coverage nodes:", error);
    return NextResponse.json({ success: false, message: "Failed to fetch coverage nodes" }, { status: 500 });
  }
}
