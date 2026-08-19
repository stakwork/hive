import { NextRequest, NextResponse } from "next/server";
import type { GraphNodeDetailResponse } from "@/types/graph-node";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock endpoint for the graph node detail view — one node plus its directly
 * linked neighbors. Mirrors the real Jarvis-backed shape so the node panel and
 * the `?ref_id=` deep link work with USE_MOCKS=true.
 */
export function getMockGraphNode(refId: string): GraphNodeDetailResponse {
  return {
    node: {
      ref_id: refId,
      node_type: "Concept",
      name: "Workspace Access Control",
      properties: {
        name: "Workspace Access Control",
        description:
          "How role checks gate workspace resources: validateWorkspaceAccess resolves membership, and canAdmin gates admin-only surfaces.",
        repo: "sphinx/hive",
        file: "src/services/workspace.ts",
      },
    },
    neighbors: [
      {
        ref_id: "validateWorkspaceAccess_src_services_workspace_ts",
        node_type: "Function",
        name: "validateWorkspaceAccess",
        edge_type: "DESCRIBES",
        direction: "forward",
        importance: 0.9,
      },
      {
        ref_id: "useWorkspaceAccess_src_hooks_useWorkspaceAccess_ts",
        node_type: "Function",
        name: "useWorkspaceAccess",
        edge_type: "DESCRIBES",
        direction: "forward",
        importance: 0.7,
      },
      {
        ref_id: "workspace_ts_src_services",
        node_type: "File",
        name: "src/services/workspace.ts",
        edge_type: "CONTAINS",
        direction: "reverse",
        importance: 0.5,
      },
      {
        ref_id: "permission_system_concept",
        node_type: "Concept",
        name: "Permission System",
        edge_type: "RELATED_TO",
        direction: "forward",
      },
    ],
  };
}

export async function GET(request: NextRequest) {
  const refId = request.nextUrl.searchParams.get("ref_id") ?? "mock_concept_ref_id";
  return NextResponse.json(getMockGraphNode(refId), { status: 200 });
}
