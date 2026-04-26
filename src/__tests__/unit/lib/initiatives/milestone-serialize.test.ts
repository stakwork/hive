/**
 * Unit tests for the shared milestone serialization helper.
 *
 * Three milestone REST routes (POST list, PATCH/DELETE single, POST
 * reorder) emit milestones via `serializeMilestone`. This helper carries
 * the 1:1 → 1:N migration shim, so it must round-trip both shapes
 * cleanly: callers reading the new `features` array AND legacy callers
 * reading `milestone.feature` (singular) both keep working.
 */
import { describe, it, expect } from "vitest";
import { serializeMilestone } from "@/lib/initiatives/milestone-serialize";
import type { MilestoneStatus } from "@prisma/client";

function makeRow(features: Array<{ id: string; title: string; workspaceId: string; workspaceName: string }>) {
  return {
    id: "m-1",
    initiativeId: "ini-1",
    name: "Milestone",
    description: null,
    status: "NOT_STARTED" as MilestoneStatus,
    sequence: 1,
    dueDate: null,
    completedAt: null,
    assigneeId: null,
    assignee: null,
    features: features.map((f) => ({
      id: f.id,
      title: f.title,
      workspace: { id: f.workspaceId, name: f.workspaceName },
    })),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("serializeMilestone", () => {
  it("emits an empty `features` array and null `feature` shim when no features are linked", () => {
    const row = makeRow([]);
    const out = serializeMilestone(row);
    expect(out.features).toEqual([]);
    expect(out.feature).toBeNull();
  });

  it("emits the full `features` array and mirrors the first onto the legacy shim", () => {
    const row = makeRow([
      { id: "f-1", title: "First", workspaceId: "w", workspaceName: "Ws" },
      { id: "f-2", title: "Second", workspaceId: "w", workspaceName: "Ws" },
    ]);
    const out = serializeMilestone(row);
    expect(out.features.map((f) => f.id)).toEqual(["f-1", "f-2"]);
    // The legacy `feature` field exists for callers still on the 1:1
    // contract; it must equal `features[0]` so reads stay consistent.
    expect(out.feature).not.toBeNull();
    expect(out.feature?.id).toBe("f-1");
  });

  it("preserves all milestone scalar fields verbatim", () => {
    const row = {
      ...makeRow([]),
      name: "Real name",
      description: "A description",
      status: "IN_PROGRESS" as MilestoneStatus,
      sequence: 7,
    };
    const out = serializeMilestone(row);
    expect(out.name).toBe("Real name");
    expect(out.description).toBe("A description");
    expect(out.status).toBe("IN_PROGRESS");
    expect(out.sequence).toBe(7);
  });
});
