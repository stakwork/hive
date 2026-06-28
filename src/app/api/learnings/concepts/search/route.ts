import { NextRequest, NextResponse } from "next/server";
import { getSwarmConfig } from "../../utils";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";
import { searchClues } from "@/lib/ai/askTools";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");
    const q = searchParams.get("q") ?? "";

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Missing required parameter: workspace" }, { status: 400 });
    }

    if (q.trim().length < 2) {
      return NextResponse.json(
        { error: "Query must be at least 2 characters" },
        { status: 400 }
      );
    }

    // Auth + IDOR guard: confirm read access before any Swarm call
    const access = await resolveWorkspaceAccess(request, { slug: workspaceSlug });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    const swarmConfig = await getSwarmConfig(ok.workspaceId);
    if ("error" in swarmConfig) {
      return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    console.log(`[ConceptSearch] query length=${q.trim().length}, workspace=${workspaceSlug}`);

    // Fetch all concepts from the swarm
    let allConcepts: Array<{ id: string; name: string; content?: string; documentation?: string }> =
      [];
    try {
      const conceptsResponse = await fetch(`${baseSwarmUrl}/gitree/concepts`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": decryptedSwarmApiKey,
        },
      });

      if (!conceptsResponse.ok) {
        console.error(`[ConceptSearch] Swarm concepts fetch failed: ${conceptsResponse.status}`);
        return NextResponse.json(
          { error: "Failed to fetch concepts from swarm" },
          { status: 500 }
        );
      }

      const data = await conceptsResponse.json();
      // stakgraph renamed `features` -> `concepts`; accept both for compatibility
      allConcepts = Array.isArray(data)
        ? data
        : Array.isArray(data?.concepts)
          ? data.concepts
          : Array.isArray(data?.features)
            ? data.features
            : [];
    } catch (err) {
      console.error("[ConceptSearch] Failed to fetch concepts from swarm:", err);
      return NextResponse.json(
        { error: "Failed to fetch concepts from swarm" },
        { status: 500 }
      );
    }

    // Literal matching: case-insensitive substring on name, content, or documentation
    const lowerQ = q.trim().toLowerCase();
    const literal = allConcepts
      .filter((c) => {
        const nameMatch = c.name?.toLowerCase().includes(lowerQ);
        const contentMatch = c.content?.toLowerCase().includes(lowerQ);
        const docMatch = c.documentation?.toLowerCase().includes(lowerQ);
        return nameMatch || contentMatch || docMatch;
      })
      .map((c) => ({ id: c.id, name: c.name }));

    const literalIds = new Set(literal.map((c) => c.id));

    console.log(`[ConceptSearch] literal matches=${literal.length}`);

    // Semantic matching via vector search, deduplicated against literal results
    const conceptIdSet = new Set(allConcepts.map((c) => c.id));
    let semantic: Array<{ id: string; name: string }> = [];
    try {
      const clueResults = await searchClues(baseSwarmUrl, decryptedSwarmApiKey, q.trim());
      semantic = clueResults
        .map((result) => result.clue.id)
        .filter((id) => conceptIdSet.has(id) && !literalIds.has(id))
        .map((id) => {
          const concept = allConcepts.find((c) => c.id === id)!;
          return { id: concept.id, name: concept.name };
        });
    } catch (err) {
      console.error("[ConceptSearch] Semantic search failed:", err);
      // Semantic failures are non-fatal; return literal results only
    }

    console.log(`[ConceptSearch] semantic matches=${semantic.length}`);

    return NextResponse.json({ literal, semantic });
  } catch (error) {
    console.error("[ConceptSearch] Unexpected error:", error);
    return NextResponse.json({ error: "Failed to search concepts" }, { status: 500 });
  }
}
