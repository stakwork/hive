import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import {
  hideLiveNode,
  showLiveNode,
  isLiveId,
  readHiddenLive,
  ROOT_REF,
} from "@/lib/canvas";

/**
 * Dedicated hide/show endpoint — keeps the hidden list out of the
 * autosave PUT path so routine edits never accidentally reset it.
 *
 * - `GET  ?ref=...` → list hidden live entries with display names for
 *   a restore UI. `ref` defaults to root. Returns `{ entries: [...] }`.
 * - `POST { ref?, id, action: "hide" | "show" }` → toggle visibility.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const ref = request.nextUrl.searchParams.get("ref") ?? ROOT_REF;

  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    const entries = await readHiddenLive(org.id, ref);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/canvas/hide] Error:", error);
    return NextResponse.json({ error: "Failed to list hidden" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;

  try {
    const body = await request.json();
    const ref = typeof body?.ref === "string" ? body.ref : ROOT_REF;
    const id = typeof body?.id === "string" ? body.id : null;
    const action = body?.action;

    if (!id || !isLiveId(id)) {
      return NextResponse.json(
        { error: "Body must include a live id (prefixed with ws: or feature:)" },
        { status: 400 },
      );
    }
    if (action !== "hide" && action !== "show") {
      return NextResponse.json(
        { error: 'action must be "hide" or "show"' },
        { status: 400 },
      );
    }

    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    if (action === "hide") {
      await hideLiveNode(org.id, ref, id);
    } else {
      await showLiveNode(org.id, ref, id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/orgs/[githubLogin]/canvas/hide] Error:", error);
    return NextResponse.json({ error: "Failed to update visibility" }, { status: 500 });
  }
}
