import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import {
  useFeatureLiveState,
  type FeatureSeed,
  type FeatureLiveOverlay,
} from "@/app/org/[githubLogin]/connections/useFeatureLiveState";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown) => void>(),
}));

vi.mock("@/hooks/useEntityChannel", () => ({
  useEntityChannel: (_kind: string, id: string | null) => {
    if (id == null) return null;
    return {
      bind: (_evt: string, h: (e: unknown) => void) => handlers.set(id, h),
      unbind: () => handlers.delete(id),
    };
  },
}));

let latest: Map<string, FeatureLiveOverlay> = new Map();
function Probe({ seeds }: { seeds: FeatureSeed[] }) {
  const { liveByFeatureId, binders } = useFeatureLiveState(seeds);
  latest = liveByFeatureId;
  return <>{binders}</>;
}

function seed(
  featureId: string,
  opts: Partial<FeatureSeed["snapshot"]> = {},
): FeatureSeed {
  return {
    featureId,
    snapshot: {
      plannerRunning: opts.plannerRunning ?? false,
      agentTasks: opts.agentTasks ?? [],
      agentsRunningCount: opts.agentsRunningCount ?? 0,
    },
  };
}

beforeEach(() => {
  handlers.clear();
  latest = new Map();
});

describe("useFeatureLiveState", () => {
  it("seeds the overlay from the projector snapshot", () => {
    render(<Probe seeds={[seed("f1", { plannerRunning: true, agentsRunningCount: 2 })]} />);
    expect(latest.get("f1")).toEqual({ plannerRunning: true, agentsRunningCount: 2 });
  });

  it("flips plannerRunning live on a planner WORKFLOW_STATUS_UPDATE", () => {
    render(<Probe seeds={[seed("f1")]} />);
    expect(latest.get("f1")?.plannerRunning).toBe(false);

    act(() => {
      handlers.get("f1")!({ taskId: "f1", workflowStatus: "IN_PROGRESS" });
    });
    expect(latest.get("f1")?.plannerRunning).toBe(true);
  });

  it("updates the agent count for a seeded child-task event", () => {
    render(
      <Probe
        seeds={[
          seed("f1", {
            agentTasks: [{ id: "t1", workflowStatus: "PENDING" }],
            agentsRunningCount: 0,
          }),
        ]}
      />,
    );
    expect(latest.get("f1")?.agentsRunningCount).toBe(0);

    act(() => {
      handlers.get("f1")!({ taskId: "t1", workflowStatus: "IN_PROGRESS" });
    });
    expect(latest.get("f1")?.agentsRunningCount).toBe(1);
  });

  it("reconciles from the authoritative snapshot on refetch", () => {
    const { rerender } = render(<Probe seeds={[seed("f1")]} />);

    act(() => {
      handlers.get("f1")!({ taskId: "f1", workflowStatus: "IN_PROGRESS" });
    });
    expect(latest.get("f1")?.plannerRunning).toBe(true);

    // A refetch with a changed projection supersedes the optimistic
    // overlay: the new snapshot (planner not running, count 5) wins.
    rerender(
      <Probe seeds={[seed("f1", { plannerRunning: false, agentsRunningCount: 5 })]} />,
    );
    expect(latest.get("f1")?.plannerRunning).toBe(false);
    expect(latest.get("f1")?.agentsRunningCount).toBe(5);
  });

  it("subscribes one binder per feature id", () => {
    render(<Probe seeds={[seed("f1"), seed("f2")]} />);
    expect(handlers.has("f1")).toBe(true);
    expect(handlers.has("f2")).toBe(true);
  });
});
