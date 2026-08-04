// @vitest-environment node
/**
 * Unit tests for enrichWorkflowArtifacts' baseline resolution.
 *
 * The case that matters most: a task that edits an EXISTING workflow but has no
 * earlier WORKFLOW artifact carrying a version. Before `previousWorkflowVersionId`
 * that resolved to null and the Changes tab rendered the entire workflow as
 * additions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db");
vi.mock("@/lib/logger");
vi.mock("@/config/env", () => ({
  config: { STAKWORK_BASE_URL: "https://api.stakwork.test/api/v1", STAKWORK_API_KEY: "test-key" },
}));

import { enrichWorkflowArtifacts } from "@/lib/helpers/workflow-version-snapshot";
import { db } from "@/lib/db";
import { ArtifactType } from "@/lib/chat";
import { Prisma } from "@prisma/client";

const mockedDb = vi.mocked(db);

const TASK_ID = "task-1";
const WORKSPACE_ID = "ws-1";
const WORKFLOW_ID = 57179;
const ARTIFACT_ID = "artifact-1";

function makeTask() {
  return { id: TASK_ID, workspaceId: WORKSPACE_ID, mode: "workflow_editor" };
}

function makeMessage(content: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    taskId: TASK_ID,
    artifacts: [
      {
        id: ARTIFACT_ID,
        type: ArtifactType.WORKFLOW as string,
        content: {
          workflowId: WORKFLOW_ID,
          workflowVersionId: "187975",
          ...content,
        } as Prisma.JsonValue,
      },
    ],
  };
}

/** Serves one `data.workflow` per version id. */
function mockStakwork(specsByVersion: Record<string, object>) {
  const fetchMock = vi.fn(async (url: string) => {
    const versionId = new URL(url).searchParams.get("workflow_version_id") ?? "";
    const workflow = specsByVersion[versionId];
    if (!workflow) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
    }
    return { ok: true, json: async () => ({ data: { workflow } }), text: async () => "" };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SPECS = {
  "187974": { transitions: { a: { name: "before" } } },
  "187975": { transitions: { a: { name: "after" } } },
  "187970": { transitions: { a: { name: "task start" } } },
};

/** The content written by the last artifact.update call. */
function persistedContent(): Record<string, unknown> {
  const calls = (
    mockedDb.artifact.update as unknown as {
      mock: { calls: [{ data: { content: Record<string, unknown> } }][] };
    }
  ).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0].data.content;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockedDb.workflowTask.findUnique = vi.fn().mockResolvedValue({ workflowId: WORKFLOW_ID }) as never;
  mockedDb.artifact.findMany = vi.fn().mockResolvedValue([]) as never;
  mockedDb.artifact.update = vi.fn().mockResolvedValue({}) as never;
});

describe("enrichWorkflowArtifacts — baseline resolution", () => {
  it("uses previousWorkflowVersionId when the producer supplies one", async () => {
    mockStakwork(SPECS);

    await enrichWorkflowArtifacts(
      makeMessage({ previousWorkflowVersionId: "187974" }),
      makeTask(),
    );

    const content = persistedContent();
    expect(content.versionSnapshot).toMatchObject({ workflowVersionId: "187975" });
    expect(content.baselineSnapshot).toMatchObject({ workflowVersionId: "187974" });
    expect(String((content.baselineSnapshot as { value: string }).value)).toContain("before");
  });

  it("accepts the snake_case spelling from the Stakwork side", async () => {
    mockStakwork(SPECS);

    await enrichWorkflowArtifacts(
      makeMessage({ previous_workflow_version_id: "187974" }),
      makeTask(),
    );

    expect(persistedContent().baselineSnapshot).toMatchObject({ workflowVersionId: "187974" });
  });

  it("null previousWorkflowVersionId on a brand-new workflow yields no baseline", async () => {
    mockStakwork(SPECS);

    await enrichWorkflowArtifacts(
      makeMessage({ previousWorkflowVersionId: null }),
      makeTask(),
    );

    expect(persistedContent().baselineSnapshot).toBeNull();
  });

  it("regression: an existing workflow with no versioned prior artifact still gets a baseline", async () => {
    // Exactly the shape that produced the all-green diff: two earlier artifacts
    // from workflow-editor.ts with no version and no snapshot.
    mockStakwork(SPECS);
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      { id: "a-1", content: { workflowId: WORKFLOW_ID, originalWorkflowJson: "" }, createdAt: new Date(1) },
      { id: "a-2", content: { workflowId: WORKFLOW_ID, originalWorkflowJson: "" }, createdAt: new Date(2) },
    ]) as never;

    await enrichWorkflowArtifacts(
      makeMessage({ previousWorkflowVersionId: "187974" }),
      makeTask(),
    );

    expect(persistedContent().baselineSnapshot).toMatchObject({ workflowVersionId: "187974" });
  });

  it("the producer's version wins over an earlier artifact's snapshot", async () => {
    mockStakwork(SPECS);
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      {
        id: "a-1",
        content: {
          workflowId: WORKFLOW_ID,
          workflowVersionId: "187970",
          versionSnapshot: { workflowVersionId: "187970", value: "task start spec" },
        },
        createdAt: new Date(1),
      },
    ]) as never;

    await enrichWorkflowArtifacts(
      makeMessage({ previousWorkflowVersionId: "187974" }),
      makeTask(),
    );

    expect(persistedContent().baselineSnapshot).toMatchObject({ workflowVersionId: "187974" });
  });

  it("ignores a previous version equal to this artifact's own", async () => {
    // Would diff the change against itself and read as "no changes detected".
    mockStakwork(SPECS);
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      {
        id: "a-1",
        content: {
          workflowId: WORKFLOW_ID,
          workflowVersionId: "187970",
          versionSnapshot: { workflowVersionId: "187970", value: "task start spec" },
        },
        createdAt: new Date(1),
      },
    ]) as never;

    await enrichWorkflowArtifacts(
      makeMessage({ previousWorkflowVersionId: "187975" }),
      makeTask(),
    );

    expect(persistedContent().baselineSnapshot).toMatchObject({ workflowVersionId: "187970" });
  });

  it("falls back to the in-task chain when the producer's version cannot be fetched", async () => {
    mockStakwork({ "187975": SPECS["187975"], "187970": SPECS["187970"] }); // 187974 missing
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      {
        id: "a-1",
        content: {
          workflowId: WORKFLOW_ID,
          workflowVersionId: "187970",
          versionSnapshot: { workflowVersionId: "187970", value: "task start spec" },
        },
        createdAt: new Date(1),
      },
    ]) as never;

    await enrichWorkflowArtifacts(
      makeMessage({ previousWorkflowVersionId: "187974" }),
      makeTask(),
    );

    expect(persistedContent().baselineSnapshot).toMatchObject({ workflowVersionId: "187970" });
  });

  it("skips enrichment entirely outside workflow_editor mode", async () => {
    const fetchMock = mockStakwork(SPECS);

    await enrichWorkflowArtifacts(makeMessage({ previousWorkflowVersionId: "187974" }), {
      ...makeTask(),
      mode: "live",
    });

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("IDOR guard: skips when the artifact's workflow is not the task's bound workflow", async () => {
    const fetchMock = mockStakwork(SPECS);
    mockedDb.workflowTask.findUnique = vi.fn().mockResolvedValue({ workflowId: 999 }) as never;

    await enrichWorkflowArtifacts(
      makeMessage({ previousWorkflowVersionId: "187974" }),
      makeTask(),
    );

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("idempotent: leaves an already-captured artifact alone", async () => {
    const fetchMock = mockStakwork(SPECS);

    await enrichWorkflowArtifacts(
      makeMessage({
        previousWorkflowVersionId: "187974",
        versionSnapshot: { workflowVersionId: "187975", value: "already captured" },
      }),
      makeTask(),
    );

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
