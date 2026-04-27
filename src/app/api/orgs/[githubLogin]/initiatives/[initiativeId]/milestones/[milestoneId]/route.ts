import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { notifyCanvasesUpdatedByLogin } from "@/lib/canvas";
import {
  MILESTONE_INCLUDE,
  serializeMilestone,
  type MilestoneWithFeatures,
} from "@/lib/initiatives/milestone-serialize";
import { Prisma } from "@prisma/client";

/**
 * Resolve a list of feature ids that belong to workspaces in this org.
 * Used to gate every connect/disconnect on the milestone↔feature relation
 * so a guessed cuid can't link a feature from another org (IDOR).
 *
 * Returns the set of valid ids (filters out unknown / cross-org ones)
 * rather than throwing — callers decide whether a partial set is OK
 * or should 404.
 */
async function filterFeaturesInOrg(
  orgId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const orgWorkspaces = await db.workspace.findMany({
    where: { deleted: false, sourceControlOrgId: orgId },
    select: { id: true },
  });
  const orgWorkspaceIds = orgWorkspaces.map((w) => w.id);
  if (orgWorkspaceIds.length === 0) return new Set();
  const validFeatures = await db.feature.findMany({
    where: {
      id: { in: candidateIds },
      deleted: false,
      workspaceId: { in: orgWorkspaceIds },
    },
    select: { id: true },
  });
  return new Set(validFeatures.map((f) => f.id));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; initiativeId: string; milestoneId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId, milestoneId } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Verify milestone belongs to the specified initiative (and initiative belongs to org)
    const existing = await db.milestone.findFirst({
      where: {
        id: milestoneId,
        initiativeId,
        initiative: { orgId },
      },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      name,
      description,
      status,
      sequence,
      dueDate,
      assigneeId,
      completedAt,
      // ── Feature linking ──
      // 1:N API. All variants below are accepted; the legacy `featureId`
      // singular is kept as a back-compat shim for the next release.
      addFeatureId,        // string   → connect one feature
      addFeatureIds,       // string[] → connect many features in one shot
      removeFeatureId,     // string   → disconnect one feature
      removeFeatureIds,    // string[] → disconnect many features in one shot
      featureIds,          // string[] → full replace via { set: [...] }
      featureId,           // legacy 1:1; treated as { set: [id] } / { set: [] }
    } = body;

    // ── Feature link mutation: build the Prisma `features` clause ──
    //
    // Precedence (top wins): featureIds (full replace) > add/remove
    // (incremental, single or array) > featureId (legacy full-replace shim).
    // Mixing featureIds with any incremental field in one request is
    // ambiguous and rejected.
    let featuresClause:
      | Prisma.FeatureUpdateManyWithoutMilestoneNestedInput
      | undefined = undefined;

    const usingArrayReplace = Array.isArray(featureIds);
    const usingIncremental =
      addFeatureId !== undefined ||
      removeFeatureId !== undefined ||
      addFeatureIds !== undefined ||
      removeFeatureIds !== undefined;
    const usingLegacy = featureId !== undefined;

    if (usingArrayReplace && usingIncremental) {
      return NextResponse.json(
        { error: "Specify either featureIds or add/remove fields, not both" },
        { status: 400 },
      );
    }

    if (usingArrayReplace) {
      if (!featureIds.every((v: unknown) => typeof v === "string")) {
        return NextResponse.json({ error: "featureIds must be string[]" }, { status: 400 });
      }
      const valid = await filterFeaturesInOrg(orgId, featureIds);
      if (valid.size !== featureIds.length) {
        return NextResponse.json({ error: "Feature not found" }, { status: 404 });
      }
      featuresClause = { set: featureIds.map((id: string) => ({ id })) };
    } else if (usingIncremental) {
      // Normalize singles + arrays into two id lists. Dedup so we never
      // emit `{ connect: [{id:x},{id:x}] }` which Prisma would reject.
      const toAdd = new Set<string>();
      const toRemove = new Set<string>();

      const addOne = (v: unknown, set: Set<string>) => {
        if (typeof v === "string" && v.length > 0) set.add(v);
      };
      const addArr = (v: unknown, set: Set<string>, label: string) => {
        if (v === undefined) return null;
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
          return label;
        }
        v.forEach((id) => set.add(id));
        return null;
      };

      addOne(addFeatureId, toAdd);
      addOne(removeFeatureId, toRemove);
      const badAdd = addArr(addFeatureIds, toAdd, "addFeatureIds");
      const badRemove = addArr(removeFeatureIds, toRemove, "removeFeatureIds");
      const badField = badAdd ?? badRemove;
      if (badField) {
        return NextResponse.json(
          { error: `${badField} must be string[]` },
          { status: 400 },
        );
      }

      const candidates = [...toAdd, ...toRemove];
      if (candidates.length > 0) {
        const valid = await filterFeaturesInOrg(orgId, candidates);
        if (valid.size !== new Set(candidates).size) {
          return NextResponse.json({ error: "Feature not found" }, { status: 404 });
        }
      }
      const ops: Prisma.FeatureUpdateManyWithoutMilestoneNestedInput = {};
      if (toAdd.size > 0) {
        ops.connect = [...toAdd].map((id) => ({ id }));
      }
      if (toRemove.size > 0) {
        ops.disconnect = [...toRemove].map((id) => ({ id }));
      }
      featuresClause = ops;
    } else if (usingLegacy) {
      // Legacy: { featureId: "x" } meant "set the single linked feature
      // to x"; { featureId: null } meant "unlink everything." Map both
      // to the new full-replace semantics.
      if (featureId === null) {
        featuresClause = { set: [] };
      } else if (typeof featureId === "string" && featureId.length > 0) {
        const valid = await filterFeaturesInOrg(orgId, [featureId]);
        if (!valid.has(featureId)) {
          return NextResponse.json({ error: "Feature not found" }, { status: 404 });
        }
        featuresClause = { set: [{ id: featureId }] };
      }
    }

    const milestone = await db.milestone.update({
      where: { id: milestoneId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(sequence !== undefined && { sequence: Number(sequence) }),
        ...(assigneeId !== undefined && { assigneeId }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
        ...(featuresClause !== undefined && { features: featuresClause }),
      },
      include: MILESTONE_INCLUDE,
    });

    // Status / sequence / due-date / feature-link can all change what
    // the projection emits. Status especially affects the root-level
    // initiative progress rollup (root) and the milestone card itself
    // on the timeline (`initiative:<id>`); a feature-link change in
    // particular flips what the milestone sub-canvas (`milestone:<id>`)
    // projects, so include that ref too.
    void notifyCanvasesUpdatedByLogin(
      githubLogin,
      ["", `initiative:${initiativeId}`, `milestone:${milestoneId}`],
      "milestone-updated",
      { initiativeId, milestoneId },
    );

    return NextResponse.json(serializeMilestone(milestone as MilestoneWithFeatures));
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A milestone with this sequence already exists for this initiative" },
        { status: 409 },
      );
    }
    console.error("[PATCH /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]] Error:", error);
    return NextResponse.json({ error: "Failed to update milestone" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string; initiativeId: string; milestoneId: string }> },
) {
  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin, initiativeId, milestoneId } = await params;
  const userId = userOrResponse.id;

  try {
    const orgId = await resolveAuthorizedOrgId(githubLogin, userId, true);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Verify milestone belongs to the specified initiative (and initiative belongs to org)
    const existing = await db.milestone.findFirst({
      where: {
        id: milestoneId,
        initiativeId,
        initiative: { orgId },
      },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    const renumber = request.nextUrl.searchParams.get("renumber") === "true";

    if (renumber) {
      // Fetch sequence before deletion, then delete + renumber siblings atomically
      const toDelete = await db.milestone.findUnique({
        where: { id: milestoneId },
        select: { sequence: true },
      });
      if (!toDelete) {
        return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
      }

      const deletedSequence = toDelete.sequence;

      await db.$transaction([
        db.milestone.delete({ where: { id: milestoneId } }),
        db.milestone.updateMany({
          where: { initiativeId, sequence: { gt: deletedSequence } },
          data: { sequence: { decrement: 1 } },
        }),
      ]);

      const updatedSiblings = await db.milestone.findMany({
        where: { initiativeId },
        include: MILESTONE_INCLUDE,
        orderBy: { sequence: "asc" },
      });

      // Renumbering shifts every milestone's `sequence`, which in turn
      // shifts their default x-axis placement on the timeline. Refresh
      // both the timeline and the root rollup.
      void notifyCanvasesUpdatedByLogin(
        githubLogin,
        ["", `initiative:${initiativeId}`],
        "milestone-deleted",
        { initiativeId, milestoneId, renumbered: true },
      );

      return NextResponse.json({
        status: "deleted",
        milestones: updatedSiblings.map((m) =>
          serializeMilestone(m as MilestoneWithFeatures),
        ),
      });
    }

    // SetNull on Feature.milestoneId is handled by DB cascade
    await db.milestone.delete({ where: { id: milestoneId } });

    void notifyCanvasesUpdatedByLogin(
      githubLogin,
      ["", `initiative:${initiativeId}`],
      "milestone-deleted",
      { initiativeId, milestoneId },
    );

    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    console.error("[DELETE /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]] Error:", error);
    return NextResponse.json({ error: "Failed to delete milestone" }, { status: 500 });
  }
}
