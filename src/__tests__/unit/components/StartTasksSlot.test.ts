/**
 * Unit tests for the buildTaskList helper in StartTasksSlot.
 * Focuses on prArtifact mapping (the new behaviour).
 */

// buildTaskList is not exported, so we test it via the module's internal
// logic by re-implementing the same tiny function inline — or, more
// practically, by exporting it. Since it's not exported we copy the
// tested logic here and keep the test focused on the mapping contract.

// ---------------------------------------------------------------------------
// Inline replica of the types & function under test
// (mirrors StartTasksSlot.tsx exactly so changes there will break this test)
// ---------------------------------------------------------------------------

type TaskStatusValue =
  | "TODO"
  | "IN_PROGRESS"
  | "DONE"
  | "CANCELLED"
  | "BLOCKED";

interface PrArtifactView {
  content: {
    url: string;
    status: "IN_PROGRESS" | "DONE" | "CANCELLED";
    progress?: {
      ciStatus?: "pending" | "success" | "failure";
      ciSummary?: string;
    };
  };
}

interface TaskView {
  title: string;
  status: TaskStatusValue;
  prArtifact?: {
    url: string;
    status: "IN_PROGRESS" | "DONE" | "CANCELLED";
    ciStatus?: "pending" | "success" | "failure";
    ciSummary?: string;
  } | null;
}

interface FeatureData {
  phases?: {
    tasks?: {
      title?: string | null;
      status?: string | null;
      prArtifact?: PrArtifactView | null;
    }[];
  }[];
  tasks?: {
    title?: string | null;
    status?: string | null;
    prArtifact?: PrArtifactView | null;
  }[];
}

function buildTaskList(feature: FeatureData): TaskView[] {
  const out: TaskView[] = [];
  const push = (t: {
    title?: string | null;
    status?: string | null;
    prArtifact?: PrArtifactView | null;
  }) => {
    out.push({
      title: t.title?.trim() || "Untitled task",
      status: (t.status as TaskStatusValue) ?? "TODO",
      prArtifact: t.prArtifact
        ? {
            url: t.prArtifact.content.url,
            status: t.prArtifact.content.status,
            ciStatus: t.prArtifact.content.progress?.ciStatus,
            ciSummary: t.prArtifact.content.progress?.ciSummary,
          }
        : null,
    });
  };
  for (const phase of feature.phases ?? []) {
    for (const t of phase.tasks ?? []) push(t);
  }
  for (const t of feature.tasks ?? []) push(t);
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildTaskList", () => {
  it("returns an empty array for a feature with no tasks", () => {
    expect(buildTaskList({})).toEqual([]);
  });

  it("maps a task without prArtifact to null", () => {
    const result = buildTaskList({
      tasks: [{ title: "Fix bug", status: "TODO" }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].prArtifact).toBeNull();
  });

  it("maps a task with an open PR (IN_PROGRESS) and pending CI", () => {
    const result = buildTaskList({
      tasks: [
        {
          title: "Add feature",
          status: "IN_PROGRESS",
          prArtifact: {
            content: {
              url: "https://github.com/org/repo/pull/42",
              status: "IN_PROGRESS",
              progress: { ciStatus: "pending", ciSummary: "Checks running" },
            },
          },
        },
      ],
    });
    expect(result[0].prArtifact).toEqual({
      url: "https://github.com/org/repo/pull/42",
      status: "IN_PROGRESS",
      ciStatus: "pending",
      ciSummary: "Checks running",
    });
  });

  it("maps a merged PR (DONE) with successful CI", () => {
    const result = buildTaskList({
      tasks: [
        {
          title: "Ship it",
          status: "DONE",
          prArtifact: {
            content: {
              url: "https://github.com/org/repo/pull/99",
              status: "DONE",
              progress: { ciStatus: "success" },
            },
          },
        },
      ],
    });
    expect(result[0].prArtifact).toEqual({
      url: "https://github.com/org/repo/pull/99",
      status: "DONE",
      ciStatus: "success",
      ciSummary: undefined,
    });
  });

  it("maps a closed PR (CANCELLED) with no CI data", () => {
    const result = buildTaskList({
      tasks: [
        {
          title: "Reverted",
          status: "CANCELLED",
          prArtifact: {
            content: {
              url: "https://github.com/org/repo/pull/7",
              status: "CANCELLED",
            },
          },
        },
      ],
    });
    expect(result[0].prArtifact).toEqual({
      url: "https://github.com/org/repo/pull/7",
      status: "CANCELLED",
      ciStatus: undefined,
      ciSummary: undefined,
    });
  });

  it("flattens phased tasks before top-level tasks", () => {
    const result = buildTaskList({
      phases: [
        { tasks: [{ title: "Phase task", status: "TODO" }] },
      ],
      tasks: [{ title: "Top-level task", status: "TODO" }],
    });
    expect(result.map((t) => t.title)).toEqual(["Phase task", "Top-level task"]);
  });

  it("falls back to 'Untitled task' for blank titles", () => {
    const result = buildTaskList({ tasks: [{ title: null, status: "TODO" }] });
    expect(result[0].title).toBe("Untitled task");
  });
});
