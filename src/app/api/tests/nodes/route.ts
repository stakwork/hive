import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";
import { convertGlobsToRegex } from "@/lib/utils/glob";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { getRepository } from "@/lib/helpers/repository";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import type { CoverageNodeConcise, CoverageNodesResponse, UncoveredNodeType, NodesResponse } from "@/types/stakgraph";
import { config } from "@/config/env";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

type ParsedParams = {
  nodeType: UncoveredNodeType;
  limit: number;
  offset: number;
  sort: string;
  coverage: "all" | "tested" | "untested";
  ignored: "all" | "ignored" | "not_ignored";
  bodyLength: boolean;
  lineCount: boolean;
  search: string;
};

function parseAndValidateParams(searchParams: URLSearchParams): ParsedParams | { error: NextResponse } {
  const nodeTypeParam = (searchParams.get("node_type") || searchParams.get("nodeType") || "endpoint").toLowerCase();
  if (nodeTypeParam !== "endpoint" && nodeTypeParam !== "function" && nodeTypeParam !== "class") {
    return {
      error: NextResponse.json(
        { success: false, message: "Invalid node_type. Use 'endpoint', 'function', or 'class'." },
        { status: 400 },
      ),
    } as const;
  }
  const nodeType = nodeTypeParam as UncoveredNodeType;
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 20)));
  const offset = Math.max(0, Number(searchParams.get("offset") || 0));
  const sort = (searchParams.get("sort") || "test_count").toLowerCase();
  let coverage = (searchParams.get("coverage") || "all").toLowerCase();
  if (!["all", "tested", "untested"].includes(coverage)) coverage = "all";
  let ignored = (searchParams.get("ignored") || "all").toLowerCase();
  if (!["all", "ignored", "not_ignored"].includes(ignored)) ignored = "all";
  const bodyLength = searchParams.get("body_length") === "true";
  const lineCount = searchParams.get("line_count") === "true";
  const search = searchParams.get("search") || "";
  return { nodeType, limit, offset, sort, coverage: coverage as "all" | "tested" | "untested", ignored: ignored as "all" | "ignored" | "not_ignored", bodyLength, lineCount, search };
}

function buildQueryString(params: ParsedParams): string {
  const q = new URLSearchParams();
  q.set("node_type", params.nodeType);
  q.set("limit", String(params.limit));
  q.set("offset", String(params.offset));
  if (params.bodyLength) {
    q.set("body_length", "true");
  } else if (params.lineCount) {
    q.set("line_count", "true");
  } else if (params.sort) {
    q.set("sort", String(params.sort));
  }
  if (params.coverage && params.coverage !== "all") q.set("coverage", params.coverage);
  if (params.ignored === "ignored") q.set("is_muted", "true");
  if (params.ignored === "not_ignored") q.set("is_muted", "false");
  if (params.search) q.set("search", params.search);
  q.set("concise", "true");
  return q.toString();
}

function buildEndpointPath(params: ParsedParams, ignoreDirs?: string | null, repo?: string | null, unitGlob?: string | null, integrationGlob?: string | null, e2eGlob?: string | null): string {
  const queryString = buildQueryString(params);
  const q = new URLSearchParams(queryString);
  if (ignoreDirs) {
    q.set("ignore_dirs", ignoreDirs);
  }
  if (repo) {
    q.set("repo", repo);
  }
  if (unitGlob) {
    const regex = convertGlobsToRegex(unitGlob);
    if (regex) q.set("unit_regexes", regex);
  }
  if (integrationGlob) {
    const regex = convertGlobsToRegex(integrationGlob);
    if (regex) q.set("integration_regexes", regex);
  }
  if (e2eGlob) {
    const regex = convertGlobsToRegex(e2eGlob);
    if (regex) q.set("e2e_regexes", regex);
  }
  return `/tests/nodes?${q.toString()}`;
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

type Payload = ItemsOrNodes & Partial<NodesResponse> & {
  total_count?: number;
  total_pages?: number;
  current_page?: number;
  total_returned?: number;
};

function normalizeResponse(
  payload: Payload,
  nodeType: UncoveredNodeType,
  limit: number,
  offset: number,
  ignoreDirs?: string | null,
  unitGlob?: string | null,
  integrationGlob?: string | null,
  e2eGlob?: string | null,
): CoverageNodesResponse {
  let items: CoverageNodeConcise[] = [];
  const mapToConcise = (n: unknown): CoverageNodeConcise => {
    const o = n as Record<string, unknown> | null;
    const props = (o?.properties as Record<string, unknown> | undefined) || undefined;
    const meta = (o?.meta as Record<string, unknown> | undefined) || undefined;
    const name = (o?.name as string) || (props?.name as string) || "";
    const file = (o?.file as string) || (props?.file as string) || "";
    const ref_id = (o?.ref_id as string) || "";
    const weight = typeof o?.weight === "number" ? (o?.weight as number) : 0;
    const testCount = typeof o?.test_count === "number" ? (o?.test_count as number) : 0;
    const covered = typeof o?.covered === "boolean" ? (o?.covered as boolean) : testCount > 0;
    const body_length = typeof o?.body_length === "number" ? (o?.body_length as number) : null;
    const line_count = typeof o?.line_count === "number" ? (o?.line_count as number) : null;
    const verb = (o?.verb as string | undefined) || undefined;
    // is_muted can be in meta as string "true"/"false", or elsewhere as boolean
    const is_muted = meta?.is_muted === "true" || meta?.is_muted === true ||
                     o?.is_muted === "true" || o?.is_muted === true ||
                     props?.is_muted === "true" || props?.is_muted === true;
    return { name, file, ref_id, weight, test_count: testCount, covered, body_length, line_count, verb, is_muted };
  };

    if (isItemsOrNodes(payload)) {
      const rawList = (payload.items || payload.nodes || []) as unknown[];
      items = rawList.map(mapToConcise);
    } else if (isNodesResponse(payload)) {
      const nodesPayload = payload as NodesResponse;
      const list = nodeType === "endpoint" ? nodesPayload.endpoints : nodesPayload.functions;
      const raw = (list as unknown[]) || [];
      items = raw.map(mapToConcise);
    }
  const total_count = typeof payload.total_count === "number" ? payload.total_count : items.length;
  const total_pages = typeof payload.total_pages === "number" ? payload.total_pages : undefined;
  const current_page = typeof payload.current_page === "number" ? payload.current_page : Math.floor(offset / limit) + 1;
  const total_returned = typeof payload.total_returned === "number" ? payload.total_returned : items.length;

  return {
    success: true,
    data: {
      node_type: nodeType,
      page: current_page,
      pageSize: limit,
      hasNextPage: items.length >= limit,
      items,
      total_count,
      total_pages,
      total_returned,
      ignoreDirs: ignoreDirs || "",
      unitGlob: unitGlob || "",
      integrationGlob: integrationGlob || "",
      e2eGlob: e2eGlob || "",
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
    const repositoryId = searchParams.get("repositoryId");
    const ignoreDirsParam = searchParams.get("ignoreDirs") || searchParams.get("ignore_dirs");
    const repoParam = searchParams.get("repo");
    const unitGlobParam = searchParams.get("unitGlob");
    const integrationGlobParam = searchParams.get("integrationGlob");
    const e2eGlobParam = searchParams.get("e2eGlob");

    const parsed = parseAndValidateParams(searchParams);
    if ("error" in parsed) return parsed.error;
    const { nodeType, limit, offset } = parsed;

    let finalIgnoreDirs = ignoreDirsParam;
    let finalUnitGlob = unitGlobParam;
    let finalIntegrationGlob = integrationGlobParam;
    let finalE2eGlob = e2eGlobParam;

    // Get repository configuration (by ID if provided, otherwise primary)
    if (workspaceId && !swarmId) {
      const targetRepo = await getRepository(workspaceId, repositoryId);
      
      if (!targetRepo && repositoryId) {
        return NextResponse.json(
          { success: false, message: "Repository not found or does not belong to workspace" },
          { status: 404 }
        );
      }

      if (targetRepo) {
        if (!ignoreDirsParam) {
          finalIgnoreDirs = targetRepo.ignoreDirs || "";
        } else if (ignoreDirsParam !== targetRepo.ignoreDirs) {
          await db.repository.update({
            where: { id: targetRepo.id },
            data: { ignoreDirs: ignoreDirsParam },
          });
        }

        if (!unitGlobParam) {
          finalUnitGlob = targetRepo.unitGlob || "";
        } else if (unitGlobParam !== targetRepo.unitGlob) {
          await db.repository.update({
            where: { id: targetRepo.id },
            data: { unitGlob: unitGlobParam },
          });
        }

        if (!integrationGlobParam) {
          finalIntegrationGlob = targetRepo.integrationGlob || "";
        } else if (integrationGlobParam !== targetRepo.integrationGlob) {
          await db.repository.update({
            where: { id: targetRepo.id },
            data: { integrationGlob: integrationGlobParam },
          });
        }

        if (!e2eGlobParam) {
          finalE2eGlob = targetRepo.e2eGlob || "";
        } else if (e2eGlobParam !== targetRepo.e2eGlob) {
          await db.repository.update({
            where: { id: targetRepo.id },
            data: { e2eGlob: e2eGlobParam },
          });
        }
      }
    }

    const endpointPath = buildEndpointPath(parsed, finalIgnoreDirs, repoParam, finalUnitGlob, finalIntegrationGlob, finalE2eGlob);

    const isLocalHost =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
    if (process.env.NODE_ENV === "development" && isLocalHost) {
      // Use mock endpoint when USE_MOCKS=true, otherwise try local graph service
      const baseUrl = config.USE_MOCKS
        ? `${config.MOCK_BASE}/api/mock/stakgraph`
        : "http://0.0.0.0:7799";
      const url = `${baseUrl}${endpointPath}`;
      const resp = await fetch(url);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return NextResponse.json(
          { success: false, message: "Failed to fetch coverage nodes (dev)", details: data },
          { status: resp.status },
        );
      }
      const response = normalizeResponse(data as Payload, nodeType, limit, offset, finalIgnoreDirs, finalUnitGlob, finalIntegrationGlob, finalE2eGlob);
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

    const response = normalizeResponse(apiResult.data as Payload, nodeType, limit, offset, finalIgnoreDirs, finalUnitGlob, finalIntegrationGlob, finalE2eGlob);
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching coverage nodes:", error);
    return NextResponse.json({ success: false, message: "Failed to fetch coverage nodes" }, { status: 500 });
  }
}
