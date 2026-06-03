/**
 * Unit tests for buildWorkflowEditorFeatureContext in src/services/workflow-editor.ts
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db");
vi.mock("@/config/env", () => ({ config: {} }));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getTaskChannelName: vi.fn(),
  PUSHER_EVENTS: {},
}));
vi.mock("@/lib/utils", () => ({ getBaseUrl: vi.fn() }));
vi.mock("@/lib/utils/swarm", () => ({ transformSwarmUrlToRepo2Graph: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({ getGithubUsernameAndPAT: vi.fn() }));
vi.mock("@/lib/vercel/stakwork-token", () => ({ getStakworkTokenReference: vi.fn() }));
vi.mock("@/lib/helpers/chat-history", () => ({ fetchChatHistory: vi.fn() }));

// ─── Subject ──────────────────────────────────────────────────────────────────

import { buildWorkflowEditorFeatureContext } from "@/services/workflow-editor";
import { db } from "@/lib/db";

const mockedDb = vi.mocked(db);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFeature() {
  return {
    id: "feature-1",
    title: "My Feature",
    brief: "A short brief",
    requirements: "Some requirements",
    architecture: "Some architecture",
    userStories: [{ title: "User story A" }, { title: "User story B" }],
    workspace: {
      repositories: [
        { id: "repo-1", name: "hive", repositoryUrl: "https://github.com/org/hive", branch: "master" },
        { id: "repo-2", name: "api", repositoryUrl: "https://github.com/org/api", branch: "main" },
      ],
    },
    phases: [
      {
        tasks: [
          { id: "task-1", title: "Task One", description: "desc one", status: "TODO", summary: null },
          { id: "task-2", title: "Task Two", description: "desc two", status: "IN_PROGRESS", summary: "in flight" },
        ],
      },
      {
        tasks: [
          { id: "task-3", title: "Task Three", description: "desc three", status: "DONE", summary: "completed" },
        ],
      },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildWorkflowEditorFeatureContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns correct shape when feature exists with tasks across multiple phases", async () => {
    mockedDb.feature.findFirst = vi.fn().mockResolvedValue(makeFeature()) as never;

    const result = await buildWorkflowEditorFeatureContext("feature-1");

    expect(result).not.toBeNull();
    const ctx = result as Record<string, unknown>;

    // feature block
    const feature = ctx.feature as Record<string, unknown>;
    expect(feature.id).toBe("feature-1");
    expect(feature.title).toBe("My Feature");
    expect(feature.brief).toBe("A short brief");
    expect(feature.requirements).toBe("Some requirements");
    expect(feature.architecture).toBe("Some architecture");
    expect(feature.userStories).toEqual(["User story A", "User story B"]);

    // workspaceRepositories
    const repos = ctx.workspaceRepositories as unknown[];
    expect(repos).toHaveLength(2);
    expect(repos[0]).toMatchObject({ id: "repo-1", name: "hive", repositoryUrl: "https://github.com/org/hive", branch: "master" });

    // currentPhase — all tasks flattened across all phases
    const currentPhase = ctx.currentPhase as Record<string, unknown>;
    expect(currentPhase.name).toBe("All Tasks");
    expect(currentPhase.description).toBeNull();
    const tickets = currentPhase.tickets as unknown[];
    expect(tickets).toHaveLength(3);
    expect(tickets[0]).toMatchObject({ id: "task-1", title: "Task One", status: "TODO" });
    expect(tickets[1]).toMatchObject({ id: "task-2", title: "Task Two", status: "IN_PROGRESS" });
    expect(tickets[2]).toMatchObject({ id: "task-3", title: "Task Three", status: "DONE" });
  });

  test("returns null when feature is not found", async () => {
    mockedDb.feature.findFirst = vi.fn().mockResolvedValue(null) as never;

    const result = await buildWorkflowEditorFeatureContext("nonexistent-feature");

    expect(result).toBeNull();
  });

  test("returns null when DB throws an error", async () => {
    mockedDb.feature.findFirst = vi.fn().mockRejectedValue(new Error("DB error")) as never;

    const result = await buildWorkflowEditorFeatureContext("feature-1");

    expect(result).toBeNull();
  });

  test("handles feature with no phases (empty tickets array)", async () => {
    mockedDb.feature.findFirst = vi.fn().mockResolvedValue({
      ...makeFeature(),
      phases: [],
    }) as never;

    const result = await buildWorkflowEditorFeatureContext("feature-1");

    expect(result).not.toBeNull();
    const ctx = result as Record<string, unknown>;
    const currentPhase = ctx.currentPhase as Record<string, unknown>;
    expect(currentPhase.tickets).toEqual([]);
  });

  test("handles feature with no workspace repositories", async () => {
    mockedDb.feature.findFirst = vi.fn().mockResolvedValue({
      ...makeFeature(),
      workspace: { repositories: [] },
    }) as never;

    const result = await buildWorkflowEditorFeatureContext("feature-1");

    expect(result).not.toBeNull();
    const ctx = result as Record<string, unknown>;
    expect(ctx.workspaceRepositories).toEqual([]);
  });

  test("handles feature with no userStories", async () => {
    mockedDb.feature.findFirst = vi.fn().mockResolvedValue({
      ...makeFeature(),
      userStories: [],
    }) as never;

    const result = await buildWorkflowEditorFeatureContext("feature-1");

    expect(result).not.toBeNull();
    const ctx = result as Record<string, unknown>;
    const feature = ctx.feature as Record<string, unknown>;
    expect(feature.userStories).toEqual([]);
  });

  test("maps userStories to an array of title strings", async () => {
    mockedDb.feature.findFirst = vi.fn().mockResolvedValue(makeFeature()) as never;

    const result = await buildWorkflowEditorFeatureContext("feature-1");

    const ctx = result as Record<string, unknown>;
    const feature = ctx.feature as Record<string, unknown>;
    // Must be strings, not objects
    expect((feature.userStories as unknown[])[0]).toBe("User story A");
  });
});
