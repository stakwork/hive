import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSwarmConfig } from "@/app/api/learnings/utils";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";

const MAX_CONCEPTS = 20;

/**
 * GET /api/orgs/[githubLogin]/concepts?q=
 *
 * Powers the "/" concept-mention menu in the org canvas composer
 * (SidebarChat). Resolves the org's default swarm (SourceControlOrg →
 * defaultWorkspaceId → Swarm) and lists its concepts, optionally filtered
 * by a case-insensitive substring match on `name`. Capped at 20 results.
 *
 * If the org has no default workspace configured, returns
 * `{ concepts: [], noDefaultSwarm: true }` rather than an error — the
 * composer renders a "No default swarm configured" message for this case.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  try {
    const { githubLogin } = await params;
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();

    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { defaultWorkspaceId: true },
    });

    if (!org?.defaultWorkspaceId) {
      return NextResponse.json({ concepts: [], noDefaultSwarm: true });
    }

    // Auth + IDOR guard: confirm read access before any Swarm call
    const access = await resolveWorkspaceAccess(request, { workspaceId: org.defaultWorkspaceId });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    const swarmConfig = await getSwarmConfig(ok.workspaceId);
    if ("error" in swarmConfig) {
      // No swarm configured for the default workspace — treat the same as
      // "no default swarm" from the composer's point of view.
      return NextResponse.json({ concepts: [], noDefaultSwarm: true });
    }

    const { baseSwarmUrl, decryptedSwarmApiKey } = swarmConfig;

    let allConcepts: Array<{ id: string; name: string }> = [];
    try {
      const conceptsResponse = await fetch(`${baseSwarmUrl}/gitree/concepts`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": decryptedSwarmApiKey,
        },
      });

      if (!conceptsResponse.ok) {
        console.error(`[OrgConcepts] Swarm concepts fetch failed: ${conceptsResponse.status}`);
        return NextResponse.json({ error: "Failed to fetch concepts from swarm" }, { status: 500 });
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
      console.error("[OrgConcepts] Failed to fetch concepts from swarm:", err);
      return NextResponse.json({ error: "Failed to fetch concepts from swarm" }, { status: 500 });
    }

    const filtered = q ? allConcepts.filter((c) => c.name?.toLowerCase().includes(q)) : allConcepts;

    const concepts = filtered.slice(0, MAX_CONCEPTS).map((c) => ({ id: c.id, name: c.name }));

    return NextResponse.json({ concepts });
  } catch (error) {
    console.error("[OrgConcepts] Unexpected error:", error);
    return NextResponse.json({ error: "Failed to fetch concepts" }, { status: 500 });
  }
}
