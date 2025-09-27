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
  page: number;
  pageSize: number;
  sort: string;
  root: string;
  status?: string;
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
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") || 10)));
  const sort = (searchParams.get("sort") || "usage").toLowerCase();
  const root = searchParams.get("root") || "";
  const status = (searchParams.get("status") || "all").toLowerCase();
  if (status && status !== "all" && status !== "tested" && status !== "untested") {
    return {
      error: NextResponse.json(
        { success: false, message: "Invalid status. Use 'all', 'tested', or 'untested'." },
        { status: 400 },
      ),
    } as const;
  }
  return { nodeType, page, pageSize, sort, root, status };
}

function buildQueryString(params: ParsedParams): string {
  const q = new URLSearchParams();
  q.set("node_type", params.nodeType);
  const offset = (params.page - 1) * params.pageSize;
  q.set("limit", String(params.pageSize));
  q.set("offset", String(offset));
  if (params.sort) q.set("sort", String(params.sort));
  if (params.root) q.set("root", String(params.root));
  q.set("concise", "true");
  if (params.status) {
    const s = String(params.status).toLowerCase();
    if (s === "tested") q.set("covered_only", "true");
    if (s === "untested") q.set("covered_only", "false");
  }
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
  page: number,
  pageSize: number,
): CoverageNodesResponse {
  let items: CoverageNodeConcise[] = [];
  const mapToConcise = (n: unknown): CoverageNodeConcise => {
    const o = n as Record<string, unknown> | null;
    const props = (o?.properties as Record<string, unknown> | undefined) || undefined;
    const name = (o?.name as string) || (props?.name as string) || "";
    const file = (o?.file as string) || (props?.file as string) || "";
    const weight = typeof o?.weight === "number" ? (o?.weight as number) : 0;
    const testCount = typeof o?.test_count === "number" ? (o?.test_count as number) : 0;
    return { name, file, weight, test_count: testCount };
  };

  if (isItemsOrNodes(payload)) {
    const rawList = (payload.items || payload.nodes || []) as unknown[];
    items = rawList.map(mapToConcise);
  } else if (isNodesResponse(payload)) {
    const list = nodeType === "endpoint" ? payload.endpoints : payload.functions;
    const raw = (list as unknown[]) || [];
    items = raw.map(mapToConcise);
  }

  return {
    success: true,
    data: {
      node_type: nodeType,
      page,
      pageSize,
      hasNextPage: items.length >= pageSize,
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
    const { nodeType, page, pageSize } = parsed;
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
      const response = normalizeResponse(data as unknown, nodeType, page, pageSize);
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

    const response = normalizeResponse(apiResult.data as unknown, nodeType, page, pageSize);
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
