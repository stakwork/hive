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

type ParsedParams = {
  nodeType: UncoveredNodeType;
  limit: string;
  offset: string;
  sort: string;
  root: string;
  concise: string;
  tests: string;
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
  const tests = (searchParams.get("tests") || "all").toLowerCase();
  return { nodeType, limit, offset, sort, root, concise, tests };
}

function buildQueryString(params: ParsedParams): string {
  const q = new URLSearchParams();
  q.set("node_type", params.nodeType);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  if (params.sort) q.set("sort", String(params.sort));
  if (params.root) q.set("root", String(params.root));
  if (params.concise) q.set("concise", String(params.concise));
  if (params.tests) q.set("tests", String(params.tests));
  q.set("output", "json");
  return q.toString();
}

function normalizeResponse(
  payload: UncoveredResponseRaw | undefined,
  nodeType: UncoveredNodeType,
  limit: string,
  offset: string,
): UncoveredItemsResponse {
  const rawItems = nodeType === "endpoint" ? payload?.endpoints : payload?.functions;
  const items: UncoveredResponseItem[] = Array.isArray(rawItems) ? rawItems : [];
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
    const workspaceId = searchParams.get("workspaceId");
    const swarmId = searchParams.get("swarmId");

    const parsed = parseAndValidateParams(searchParams);
    if ("error" in parsed) return parsed.error;
    const { nodeType, limit, offset } = parsed;
    const endpointPath = `/tests/uncovered?${buildQueryString(parsed)}`;

    const isLocalHost =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
    if (process.env.NODE_ENV === "development" && isLocalHost) {
      const url = `http://0.0.0.0:7799${endpointPath}`;
      const resp = await fetch(url);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return NextResponse.json(
          { success: false, message: "Failed to fetch uncovered data (dev)", details: data },
          { status: resp.status },
        );
      }
      const response = normalizeResponse((data || {}) as UncoveredResponseRaw, nodeType, limit, offset);
      return NextResponse.json(response, { status: 200 });
    }

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

    const response = normalizeResponse((apiResult.data || {}) as UncoveredResponseRaw, nodeType, limit, offset);
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching uncovered data:", error);
    return NextResponse.json({ success: false, message: "Failed to fetch uncovered data" }, { status: 500 });
  }
}
