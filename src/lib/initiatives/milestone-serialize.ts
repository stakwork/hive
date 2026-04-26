/**
 * Shared serialization for the Milestone REST routes.
 *
 * The three milestone API routes (`POST /milestones`, `PATCH /:id`,
 * `POST /reorder`) all need the same Prisma `include` shape and the
 * same response shape. Centralizing them here means a schema tweak
 * (e.g. adding `dueDate` to the canonical response) is one edit, not
 * three, and the wire shape stays consistent across endpoints.
 *
 * ---
 *
 * **1:N migration note.** The schema models `Milestone.features` as
 * `Feature[]` (1:N), but the API surface historically clamped it to
 * 1:1 via `take: 1` on the include and a `feature` (singular) field
 * on the response. As of the milestone-progress work we expose the
 * full array.
 *
 * For one release we keep the `feature` singular field populated with
 * `features[0] ?? null` as a backwards-compatibility shim — clients
 * that read `milestone.feature` keep working until they migrate to
 * `milestone.features`. Drop the shim when no in-tree caller uses it
 * (search for `milestone.feature\b`).
 */
import type { MilestoneStatus } from "@prisma/client";

/** Prisma `include` for milestone reads. Single source of truth. */
export const MILESTONE_INCLUDE = {
  assignee: { select: { id: true, name: true } },
  features: {
    select: {
      id: true,
      title: true,
      workspace: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

/** Linked-feature shape on the milestone response. */
export interface MilestoneFeatureRef {
  id: string;
  title: string;
  workspace: { id: string; name: string };
}

/**
 * Loose row shape compatible with what Prisma returns when we use
 * `MILESTONE_INCLUDE`. Typed loosely (instead of via `Prisma.MilestoneGetPayload`)
 * because the routes assemble these from various code paths and tests
 * stub them out — a strict type would force every test to construct a
 * full Prisma payload.
 */
export interface MilestoneWithFeatures {
  id: string;
  initiativeId: string;
  name: string;
  description: string | null;
  status: MilestoneStatus;
  sequence: number;
  dueDate: Date | null;
  completedAt: Date | null;
  assigneeId: string | null;
  assignee: { id: string; name: string | null } | null;
  features: MilestoneFeatureRef[];
  createdAt: Date;
  updatedAt: Date;
}

/** Shape of the JSON response returned to clients. */
export interface SerializedMilestone {
  id: string;
  initiativeId: string;
  name: string;
  description: string | null;
  status: MilestoneStatus;
  sequence: number;
  dueDate: Date | null;
  completedAt: Date | null;
  assigneeId: string | null;
  assignee: { id: string; name: string | null } | null;
  features: MilestoneFeatureRef[];
  /** @deprecated Use `features`. Kept for one release as a 1:1→1:N migration shim. */
  feature: MilestoneFeatureRef | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Format a Prisma milestone row (with `MILESTONE_INCLUDE` applied) for
 * the wire. Surfaces the linked features as both `features` (canonical,
 * 1:N) and `feature` (deprecated singular, = `features[0] ?? null`).
 */
export function serializeMilestone(
  milestone: MilestoneWithFeatures,
): SerializedMilestone {
  const features = milestone.features ?? [];
  return {
    ...milestone,
    features,
    feature: features[0] ?? null,
  };
}
