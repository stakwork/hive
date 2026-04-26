/**
 * Wire-format types for the org Initiative + Milestone REST endpoints.
 *
 * The shapes here mirror what `serializeMilestone` /
 * `serializeInitiative` emit (`src/lib/initiatives/milestone-serialize.ts`).
 * Keep them in sync — when the serializer changes, this file changes.
 */

/** A linked feature's projection into the milestone response. */
export interface MilestoneFeatureRef {
  id: string;
  title: string;
  workspace: { id: string; name: string };
}

export interface MilestoneResponse {
  id: string;
  initiativeId: string;
  name: string;
  description: string | null;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  sequence: number;
  dueDate: string | null;
  completedAt: string | null;
  assignee: { id: string; name: string | null } | null;
  /** Canonical 1:N field. May be empty. Sorted by Feature.createdAt asc. */
  features: MilestoneFeatureRef[];
  /**
   * @deprecated Use `features`. Equal to `features[0] ?? null`. Kept for
   * one release as a 1:1 → 1:N migration shim; remove once no in-tree
   * caller reads it (`grep -rn "milestone\.feature\b"`).
   */
  feature: MilestoneFeatureRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeResponse {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
  assignee: { id: string; name: string | null } | null;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  milestones: MilestoneResponse[];
}
