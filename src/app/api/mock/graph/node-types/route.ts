import { NextResponse } from "next/server";
import type { GraphNodeTypesResponse } from "@/types/graph-node";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mock node-type ontology for the search filter. */
export function getMockNodeTypes(): GraphNodeTypesResponse {
  return {
    node_types: [
      { type: "Concept", domain: "knowledge", description: "A documented idea in the codebase." },
      { type: "File", domain: "code", description: "A source file." },
      { type: "Function", domain: "code", description: "A function or method." },
      { type: "Class", domain: "code", description: "A class definition." },
      { type: "Endpoint", domain: "code", description: "An HTTP route handler." },
      { type: "Datamodel", domain: "code", description: "A persisted data model." },
    ],
  };
}

export async function GET() {
  return NextResponse.json(getMockNodeTypes(), { status: 200 });
}
