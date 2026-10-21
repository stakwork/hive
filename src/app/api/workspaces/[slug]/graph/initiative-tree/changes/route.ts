import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { hasRoleLevel, WorkspaceRole } from "@/lib/auth/roles";
import { MAX_OPS, MAX_TEXT, saveInitiativeChanges } from "@/services/graph/initiative-write";
import { INITIATIVE_TREE_LABELS } from "@/services/graph/workbench";

export const runtime = "nodejs";

const id = z.string().min(1).max(64);
const fields = z.record(z.string().max(32), z.union([z.string().max(MAX_TEXT + 200), z.number()]));

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), temp: id, type: z.enum(INITIATIVE_TREE_LABELS), parent: id.nullable(), fields }),
  z.object({ op: z.literal("edit"), ref: id, fields }),
  z.object({ op: z.literal("remove"), ref: id }),
  z.object({ op: z.literal("schedule"), ref: id, milestone: id.nullable() }),
  z.object({ op: z.literal("choose"), root: id, option: id, chosen: z.boolean() }),
]);

const bodySchema = z.object({
  root: id.nullable(),
  ops: z.array(opSchema).min(1).max(MAX_OPS),
});

/**
 * POST /api/workspaces/[slug]/graph/initiative-tree/changes
 *
 * Saves a person's edits to one initiative's plan straight to the graph: new
 * milestones, briefs, features, stories and requirements; field edits (name,
 * text, status, a milestone's order); deleting a story or requirement;
 * scheduling a requirement into a milestone; and choosing an answer in a
 * brainstorm about the plan (alone in its batch), which makes the level below.
 * Each is stamped with who did it and when. `root: null` starts a new
 * initiative. Developers and above only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
  if (access instanceof NextResponse) return access;
  if (!hasRoleLevel(access.role, WorkspaceRole.DEVELOPER)) {
    return NextResponse.json({ error: "You need developer access to change initiatives." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid changes", issues: parsed.error.issues }, { status: 400 });

  const result = await saveInitiativeChanges({ slug, userId: access.userId }, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json(result.data);
}
