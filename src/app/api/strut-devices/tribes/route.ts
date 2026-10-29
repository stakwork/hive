import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { validateDeviceCredential } from "@/lib/strut-devices";
import { jamieAccount } from "@/lib/tribes/jamie";
import { linkableWorkspace, parseTribeRef, queueTribeJoin, tribeLinkView, tribeName } from "@/lib/tribes/tribeLinks";

/**
 * /api/strut-devices/tribes — a paired device (Peel) links a Sphinx tribe
 * its person owns to one of their orgs, so `@jamie` there is a turn of the
 * org's orchestrator, run as them (`docs/plans/jamie-in-tribes.md`,
 * "Linking"). `DELETE /api/strut-devices/tribes/<pubkey>` unlinks.
 *
 * Authenticated by the device credential alone (a `webhook` route in the
 * middleware), like `/api/strut-devices/calls`. Off — 503 — until Jamie is
 * configured (`JAMIE_SERVICE_TOKEN`, `JAMIE_SPHINX_PUBKEY`).
 *
 * Header: Authorization: Bearer hivedev_…
 *
 * GET → 200 { jamie: { pubkey, alias }, tribes: [{ pubkey, host, name, workspace, org, createdAt }] }
 *   The person's links, so each of their devices shows the same pick.
 *
 * POST { workspace: "<slug>", tribe: { pubkey, host, name? } }
 *   → 200 { jamie: { pubkey, alias }, tribe: { … } }
 *   Stores the link and tells Jamie to join (a member request in a private
 *   tribe, which the owner's Peel approves when its pubkey is `jamie.pubkey`).
 *   Linking a tribe again moves it to the workspace named; to another org,
 *   it starts a new conversation.
 * 400: no workspace, a bad tribe, a workspace with no org
 * 401: unknown or revoked credential
 * 403: no access to the workspace
 * 404: no such workspace
 * 409: someone else linked this tribe
 * 503: Jamie is not configured
 */

async function authorize(request: NextRequest) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const device = await validateDeviceCredential(bearer);
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jamie = jamieAccount();
  if (!jamie) return NextResponse.json({ error: "Jamie in tribes is not configured" }, { status: 503 });
  return { device, jamie };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth instanceof NextResponse) return auth;
    const links = await db.tribeLink.findMany({
      where: { userId: auth.device.userId },
      select: {
        tribePubkey: true,
        tribeHost: true,
        name: true,
        workspaceSlug: true,
        createdAt: true,
        org: { select: { githubLogin: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ jamie: auth.jamie, tribes: links.map(tribeLinkView) });
  } catch (error) {
    logger.error("Strut device tribe list failed", "STRUT_DEVICES", { error });
    return NextResponse.json({ error: "Failed to list tribes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth.device;

    const body = (await request.json().catch(() => null)) as { workspace?: unknown; tribe?: unknown } | null;
    const slug = body && typeof body === "object" ? body.workspace : undefined;
    if (typeof slug !== "string" || !slug) {
      return NextResponse.json({ error: "workspace is required" }, { status: 400 });
    }
    const tribe = parseTribeRef(body?.tribe);
    if (typeof tribe === "string") return NextResponse.json({ error: tribe }, { status: 400 });
    const name = tribeName((body?.tribe as { name?: unknown }).name);

    const workspace = await linkableWorkspace(userId, slug);
    if (!workspace.ok) return NextResponse.json({ error: workspace.error }, { status: workspace.status });

    // One link per tribe, and only its first linker's: Hive cannot tell who
    // owns a tribe, so a second person never takes over a link — that would
    // hand them a private tribe's messages through Jamie.
    const existing = await db.tribeLink.findUnique({
      where: { tribePubkey: tribe.pubkey },
      select: { userId: true, orgId: true },
    });
    if (existing && existing.userId !== userId) {
      return NextResponse.json({ error: "This tribe is linked to an org by someone else." }, { status: 409 });
    }

    const fields = {
      tribeHost: tribe.host,
      orgId: workspace.orgId,
      workspaceSlug: workspace.workspaceSlug,
      ...(name ? { name } : {}),
    };
    const link = await db.tribeLink.upsert({
      where: { tribePubkey: tribe.pubkey },
      create: { tribePubkey: tribe.pubkey, userId, ...fields },
      update: {
        ...fields,
        // Another org's turns cannot go on this org's conversation.
        ...(existing && existing.orgId !== workspace.orgId ? { conversationId: null, cursor: null, readAt: null } : {}),
      },
      select: {
        tribePubkey: true,
        tribeHost: true,
        name: true,
        workspaceSlug: true,
        createdAt: true,
        org: { select: { githubLogin: true } },
      },
    });
    // Already in it is done on Jamie's side, so a link made again joins again.
    await queueTribeJoin(tribe);
    logger.info("Tribe linked", "STRUT_DEVICES", { tribe: tribe.pubkey, workspace: workspace.workspaceSlug });
    return NextResponse.json({ jamie: auth.jamie, tribe: tribeLinkView(link) });
  } catch (error) {
    logger.error("Strut device tribe link failed", "STRUT_DEVICES", { error });
    return NextResponse.json({ error: "Failed to link the tribe" }, { status: 500 });
  }
}
