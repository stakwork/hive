// @vitest-environment node
/**
 * Unit tests for enrichPublishPromptArtifacts.
 *
 * Tests cover:
 * - Happy path baseline capture
 * - Drift guard (artifact's own version already published → resolve to prior version)
 * - Missing/unsynced prompt row → leave fields unset + log skip
 * - IDOR skip when promptId not linked to task workspace via PromptUsage
 * - Workspace gating: non-stakwork workspace → skip
 * - No prompt value ever written to logger/console
 * - New-prompt fallback (no published version → baselineSnapshot: null)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db");
vi.mock("@/lib/logger");

import { enrichPublishPromptArtifacts } from "@/lib/helpers/prompt-baseline-snapshot";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ArtifactType } from "@/lib/chat";
import { Prisma } from "@prisma/client";

const mockedDb = vi.mocked(db);
const mockedLogger = vi.mocked(logger);

// ── Shared fixtures ────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-stakwork";
const TASK_ID = "task-1";
const PROMPT_ID = "prompt-abc";
const ARTIFACT_ID = "artifact-1";
const MSG_ID = "msg-1";

const PUBLISHED_VERSION_ID = "pv-1";
const ARTIFACT_VERSION_ID = "pv-2"; // different from published
const DRIFT_VERSION_ID = "pv-3"; // when artifact is already published

function makeTask() {
  return { id: TASK_ID, workspaceId: WORKSPACE_ID };
}

function makeMessage(artifactContent: Record<string, unknown> = {}) {
  return {
    id: MSG_ID,
    taskId: TASK_ID,
    artifacts: [
      {
        id: ARTIFACT_ID,
        type: ArtifactType.PUBLISH_PROMPT as string,
        content: {
          promptId: PROMPT_ID,
          promptVersionId: ARTIFACT_VERSION_ID,
          promptName: "MY_PROMPT",
          published: false,
          ...artifactContent,
        } as Prisma.JsonValue,
      },
    ],
  };
}

function makePublishedVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: PUBLISHED_VERSION_ID,
    value: "published prompt text",
    versionNumber: 1,
    promptId: PROMPT_ID,
    ...overrides,
  };
}

function makeArtifactVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTIFACT_VERSION_ID,
    value: "new artifact prompt text",
    versionNumber: 2,
    promptId: PROMPT_ID,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  // Default: stakwork workspace matches
  mockedDb.workspace.findFirst = vi.fn().mockResolvedValue({ id: WORKSPACE_ID }) as never;

  // Default: PromptUsage links promptId to workspace
  mockedDb.promptUsage.findMany = vi.fn().mockResolvedValue([
    { promptId: PROMPT_ID },
  ]) as never;

  // Default: artifact.update succeeds
  mockedDb.artifact.update = vi.fn().mockResolvedValue({}) as never;
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("enrichPublishPromptArtifacts", () => {

  it("happy path: captures baseline and version snapshots", async () => {
    const publishedVersion = makePublishedVersion();
    const artifactVersion = makeArtifactVersion();

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(artifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: PUBLISHED_VERSION_ID,
      publishedVersion,
    }) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ARTIFACT_ID },
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: {
              value: publishedVersion.value,
              versionId: PUBLISHED_VERSION_ID,
              versionNumber: 1,
            },
            versionSnapshot: {
              value: artifactVersion.value,
              versionNumber: 2,
            },
          }),
        }),
      }),
    );
  });

  it("drift guard: if artifact's version is already published, resolves baseline to prior version", async () => {
    // The artifact's version ID matches the published version — drift guard applies
    const driftArtifactVersion = { id: DRIFT_VERSION_ID, value: "already-published text", versionNumber: 3, promptId: PROMPT_ID };
    const priorVersion = { id: "pv-prior", value: "prior version text", versionNumber: 2, promptId: PROMPT_ID };

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(driftArtifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: DRIFT_VERSION_ID,
      publishedVersion: { id: DRIFT_VERSION_ID, value: "already-published text", versionNumber: 3 },
    }) as never;
    mockedDb.promptVersion.findFirst = vi.fn().mockResolvedValue(priorVersion) as never;

    const msg = makeMessage({ promptVersionId: DRIFT_VERSION_ID });
    await enrichPublishPromptArtifacts(msg, makeTask());

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: {
              value: priorVersion.value,
              versionId: priorVersion.id,
              versionNumber: 2,
            },
          }),
        }),
      }),
    );
  });

  it("drift guard: if no prior version exists, sets baselineSnapshot to null", async () => {
    const driftArtifactVersion = { id: DRIFT_VERSION_ID, value: "first and only version", versionNumber: 1, promptId: PROMPT_ID };

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(driftArtifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: DRIFT_VERSION_ID,
      publishedVersion: { id: DRIFT_VERSION_ID, value: "first and only version", versionNumber: 1 },
    }) as never;
    mockedDb.promptVersion.findFirst = vi.fn().mockResolvedValue(null) as never;

    const msg = makeMessage({ promptVersionId: DRIFT_VERSION_ID });
    await enrichPublishPromptArtifacts(msg, makeTask());

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({ baselineSnapshot: null }),
        }),
      }),
    );
  });

  it("new-prompt: if no publishedVersionId, sets baselineSnapshot to null but writes versionSnapshot", async () => {
    const artifactVersion = makeArtifactVersion();

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(artifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: null,
      publishedVersion: null,
    }) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: null,
            versionSnapshot: { value: artifactVersion.value, versionNumber: 2 },
          }),
        }),
      }),
    );
  });

  it("missing prompt row: leaves fields unset and logs the skip", async () => {
    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue({ id: ARTIFACT_VERSION_ID, value: "text", versionNumber: 2, promptId: PROMPT_ID }) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue(null) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    // artifact.update should NOT have been called
    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
    // logger should have been called with a skip reason
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("[prompt-baseline-snapshot]"),
      "prompt-baseline-snapshot",
      expect.anything(),
    );
  });

  it("missing artifact version row: leaves fields unset and logs the skip", async () => {
    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(null) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("[prompt-baseline-snapshot]"),
      "prompt-baseline-snapshot",
      expect.anything(),
    );
  });

  it("IDOR guard: skips and logs when promptId is not linked to workspace via PromptUsage", async () => {
    // PromptUsage returns empty — no linkage
    mockedDb.promptUsage.findMany = vi.fn().mockResolvedValue([]) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
    expect(mockedDb.prompt.findUnique).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[prompt-baseline-snapshot]"),
      "prompt-baseline-snapshot",
      expect.objectContaining({ promptId: PROMPT_ID }),
    );
  });

  it("workspace gating: skips entirely when task is not in stakwork workspace", async () => {
    // workspace.findFirst returns null → not in stakwork
    mockedDb.workspace.findFirst = vi.fn().mockResolvedValue(null) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
    expect(mockedDb.promptUsage.findMany).not.toHaveBeenCalled();
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("[prompt-baseline-snapshot]"),
      "prompt-baseline-snapshot",
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    );
  });

  it("skips if snapshot already present (idempotent)", async () => {
    const msgWithSnapshot = makeMessage({
      baselineSnapshot: { value: "already captured", versionId: PUBLISHED_VERSION_ID, versionNumber: 1 },
    });

    await enrichPublishPromptArtifacts(msgWithSnapshot, makeTask());

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
  });

  it("no-op for non-PUBLISH_PROMPT artifacts", async () => {
    const msg = {
      id: MSG_ID,
      taskId: TASK_ID,
      artifacts: [
        {
          id: "workflow-artifact",
          type: ArtifactType.WORKFLOW as string,
          content: { workflowId: 42 } as Prisma.JsonValue,
        },
      ],
    };

    await enrichPublishPromptArtifacts(msg, makeTask());

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
  });

  it("asserts no prompt value (text content) ever appears in logger calls", async () => {
    const SENSITIVE_VALUE = "SUPER_SECRET_PROMPT_BODY_TEXT";
    const publishedVersion = makePublishedVersion({ value: SENSITIVE_VALUE });
    const artifactVersion = makeArtifactVersion({ value: `artifact: ${SENSITIVE_VALUE}` });

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(artifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: PUBLISHED_VERSION_ID,
      publishedVersion,
    }) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    // Inspect all logger calls for the sensitive value
    const allCalls = [
      ...mockedLogger.info.mock.calls,
      ...mockedLogger.warn.mock.calls,
      ...mockedLogger.error.mock.calls,
    ];
    for (const [msg, context] of allCalls) {
      const serialized = JSON.stringify([msg, context]);
      expect(serialized).not.toContain(SENSITIVE_VALUE);
    }

    // Also check console.log / console.error
    const consoleCalls = [
      ...(console.log as ReturnType<typeof vi.spyOn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.spyOn>).mock.calls,
    ];
    for (const args of consoleCalls) {
      const serialized = JSON.stringify(args);
      expect(serialized).not.toContain(SENSITIVE_VALUE);
    }
  });
});
