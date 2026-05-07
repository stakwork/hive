import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { loadNodeDetail } from "@/services/orgs/nodeDetail";

/**
 * Detail endpoint for a single live canvas node.
 *
 * The org canvas projects DB entities onto nodes whose ids carry a
 * prefix indicating their kind: `ws:<id>`, `repo:<id>`, `initiative:<id>`,
 * `milestone:<id>`, `feature:<id>`, `task:<id>`. The projector itself
 * only emits the bare minimum needed for rendering (name + a few
 * footer counts); the side panel needs more — at minimum, the entity's
 * `description`. This endpoint resolves the prefix, looks up the
 * entity, and verifies it actually belongs to the org in the URL.
 *
 * The cross-org guard is the load-bearing security check here: live
 * ids travel through `?canvas=` URLs and Pusher payloads and aren't
 * scoped to the viewer's org otherwise. Without this check, an
 * authenticated user could read any initiative's description by
 * guessing a cuid.
 *
 * 404 covers both "entity doesn't exist" and "entity exists in a
 * different org" — never leak existence across org boundaries.
 *
 * The actual lookup logic lives in `@/services/orgs/nodeDetail` so the
 * canvas-chat agent can reuse it via `read_initiative` /
 * `read_milestone` tools without duplicating the cross-org guard.
 */

const PREFIX_RE = /^([a-z]+):(.+)$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; liveId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, liveId: rawLiveId } = await params;
  // Next.js URL-decodes path segments, but defensively decode again
  // so a double-encoded id doesn't slip through as `ws%3Aabc`.
  const liveId = decodeURIComponent(rawLiveId);

  const match = PREFIX_RE.exec(liveId);
  if (!match) {
    return NextResponse.json({ error: "Invalid live id" }, { status: 400 });
  }
  const [, kind, id] = match;

  const org = await db.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const detail = await loadNodeDetail(kind, id, org.id);
    if (!detail) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[GET /api/orgs/.../canvas/node/[liveId]] Error:", error);
    return NextResponse.json({ error: "Failed to load node" }, { status: 500 });
  }
}
