import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { hasRoleLevel, WorkspaceRole } from "@/lib/auth/roles";
import { MAX_OPS, MAX_REASON, MAX_TEXT, saveBrainstormChanges } from "@/services/graph/brainstorm-write";

export const runtime = "nodejs";

const id = z.string().min(1).max(64);
const text = z.string().max(MAX_TEXT + 200);
const reason = z.string().max(MAX_REASON).optional();

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_question"), temp: id, parent: id.nullable(), text }),
  z.object({ op: z.literal("add_option"), temp: id, parent: id, text }),
  z.object({ op: z.literal("edit_text"), ref: id, text }),
  z.object({ op: z.literal("choose"), ref: id, reason }),
  z.object({ op: z.literal("unchoose"), ref: id, reason }),
  z.object({ op: z.literal("reject"), ref: id, reason }),
  z.object({ op: z.literal("reopen"), ref: id, reason }),
  z.object({ op: z.literal("remove"), ref: id, reason }),
  z.object({ op: z.literal("link"), ref: id, edge: z.enum(["ABOUT", "BUILDS_ON"]), target: id }),
]);

const bodySchema = z.object({
  root: id.nullable(),
  ops: z.array(opSchema).min(1).max(MAX_OPS),
  expected: z.record(id, z.object({ state: z.string().max(32), state_at: z.number().nullable() })).optional(),
});

/**
 * POST /api/workspaces/[slug]/graph/brainstorms/changes
 *
 * Saves a person's edits to one brainstorm tree straight to the graph: new
 * questions and options, text, choose / deselect / drop / reopen, remove and
 * links, each stamped with who did it and when. `root: null` starts a new
 * brainstorm. Developers and above only. 409 with the fresh tree when a card
 * changed since the client loaded it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
  if (access instanceof NextResponse) return access;
  if (!hasRoleLevel(access.role, WorkspaceRole.DEVELOPER)) {
    return NextResponse.json({ error: "You need developer access to change brainstorms." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid changes", issues: parsed.error.issues }, { status: 400 });

  const result = await saveBrainstormChanges({ slug, userId: access.userId }, parsed.data);
  if (!result.ok) {
    const { status, message, conflicts, tree } = result;
    return NextResponse.json({ error: message, ...(conflicts && { conflicts }), ...(tree && { tree }) }, { status });
  }
  return NextResponse.json(result.data);
}
