/**
 * The System view's two stored edges (`_components/infinite-canvas/system/edges.ts`),
 * as `UrnEdge` rows:
 *
 *   IN_AREA  feature → SysComponent  the district a feature stands in (one per feature)
 *   EXTENDS  feature → feature       the earlier feature it builds on (one parent, no cycles)
 *
 * GET    → { edges: [{ fromUrn, toUrn, type }] } for the org.
 * PUT    { type, feature: { ws, id }, to: { ws, type, id } } writes one edge.
 * DELETE { type, feature: { ws, id } } removes the feature's edge of that type.
 *
 * Any member of the org may read and write them, like the plan itself. TODO:
 * promote both to graph edges (ontology change) and drop the table rows.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { deleteEdge, listEdges, upsertEdge } from "@/lib/urn/edges";
import {
  EXTENDS,
  FEATURE_TYPE,
  IN_AREA,
  SYSTEM_EDGE_TYPES,
  checkExtends,
  edgeMaps,
  graphUrn,
} from "@/app/org/[githubLogin]/_components/infinite-canvas/system/edges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_TAG = "SYSTEM_EDGES";
// A URN segment: no colons (they separate the parts).
const segment = z.string().regex(/^[A-Za-z0-9_.~-]{1,128}$/);
const typeSchema = z.enum([IN_AREA, EXTENDS]);
const featureSchema = z.object({ ws: segment, id: segment });
const putSchema = z.object({
  type: typeSchema,
  feature: featureSchema,
  to: z.object({ ws: segment, type: z.string().regex(/^[A-Za-z]{1,40}$/), id: segment }),
});
const deleteSchema = z.object({ type: typeSchema, feature: featureSchema });

type Ctx = { params: Promise<{ githubLogin: string }> };

async function authorize(request: NextRequest, githubLogin: string) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const orgId = await resolveAuthorizedOrgId(githubLogin, userOrResponse.id, false);
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return orgId;
}

/** Only the org's own workspaces can be named in an edge. */
const workspaceInOrg = async (orgId: string, slug: string) =>
  !!(await db.workspace.findFirst({ where: { slug, sourceControlOrgId: orgId, deleted: false }, select: { id: true } }));

const storedRows = async (orgId: string) =>
  (await Promise.all(SYSTEM_EDGE_TYPES.map((type) => listEdges(orgId, { type })))).flat();

export async function GET(request: NextRequest, { params }: Ctx) {
  const { githubLogin } = await params;
  const orgId = await authorize(request, githubLogin);
  if (orgId instanceof NextResponse) return orgId;
  try {
    const rows = await storedRows(orgId);
    return NextResponse.json({ edges: rows.map(({ fromUrn, toUrn, type }) => ({ fromUrn, toUrn, type })) });
  } catch (err) {
    logger.error("System edges read failed", LOG_TAG, { githubLogin, error: String(err) });
    return NextResponse.json({ error: "Could not read the edges" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { githubLogin } = await params;
  const orgId = await authorize(request, githubLogin);
  if (orgId instanceof NextResponse) return orgId;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid edge" }, { status: 400 });
  const { type, feature, to } = parsed.data;

  if (type === IN_AREA && !to.type.startsWith("Sys"))
    return NextResponse.json({ error: "A feature stands in a System Map node" }, { status: 400 });
  if (type === EXTENDS && to.type !== FEATURE_TYPE)
    return NextResponse.json({ error: "A feature extends another feature" }, { status: 400 });
  if (!(await workspaceInOrg(orgId, feature.ws)) || !(await workspaceInOrg(orgId, to.ws)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fromUrn = graphUrn(githubLogin, feature.ws, FEATURE_TYPE, feature.id);
  const toUrn = graphUrn(githubLogin, to.ws, to.type, to.id);
  try {
    const rows = await storedRows(orgId);
    if (type === EXTENDS) {
      const check = checkExtends(edgeMaps(rows).extendsOf, feature.id, to.id);
      if (!check.ok) {
        logger.warn("EXTENDS rejected", LOG_TAG, { reason: check.reason, from: fromUrn, to: toUrn });
        return NextResponse.json({ error: `Can't extend that: ${check.reason}`, reason: check.reason }, { status: 409 });
      }
    } else {
      // One area per feature: the new one replaces the old.
      for (const row of rows) if (row.type === IN_AREA && row.fromUrn === fromUrn && row.toUrn !== toUrn) await deleteEdge(row.id);
    }
    await upsertEdge(orgId, fromUrn, toUrn, type);
    logger.info("System edge written", LOG_TAG, { type, from: fromUrn, to: toUrn });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("System edge write failed", LOG_TAG, { githubLogin, error: String(err) });
    return NextResponse.json({ error: "Could not save the edge" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { githubLogin } = await params;
  const orgId = await authorize(request, githubLogin);
  if (orgId instanceof NextResponse) return orgId;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid edge" }, { status: 400 });
  const { type, feature } = parsed.data;
  if (!(await workspaceInOrg(orgId, feature.ws))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const fromUrn = graphUrn(githubLogin, feature.ws, FEATURE_TYPE, feature.id);
  try {
    const rows = (await listEdges(orgId, { fromUrn, type })) ?? [];
    for (const row of rows) {
      await deleteEdge(row.id);
      logger.info("System edge removed", LOG_TAG, { type, from: row.fromUrn, to: row.toUrn });
    }
    return NextResponse.json({ ok: true, removed: rows.length });
  } catch (err) {
    logger.error("System edge delete failed", LOG_TAG, { githubLogin, error: String(err) });
    return NextResponse.json({ error: "Could not remove the edge" }, { status: 500 });
  }
}
