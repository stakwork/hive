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

  it("drift guard: resolves baseline to the previously-published version via publishedAt", async () => {
    // The artifact's version ID matches the published version — drift guard applies.
    // The previously-published version is the one with the greatest non-null publishedAt
    // (other than the current one). This test verifies the query uses publishedAt.
    const driftArtifactVersion = { id: DRIFT_VERSION_ID, value: "newly published text", versionNumber: 3, promptId: PROMPT_ID };
    const previouslyPublished = { id: "pv-prev-pub", value: "previously published text", versionNumber: 1 };

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(driftArtifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: DRIFT_VERSION_ID,
      publishedVersion: { id: DRIFT_VERSION_ID, value: "newly published text", versionNumber: 3 },
    }) as never;
    // First findFirst call: publishedAt-based query returns the previously-published version
    mockedDb.promptVersion.findFirst = vi.fn().mockResolvedValue(previouslyPublished) as never;

    const msg = makeMessage({ promptVersionId: DRIFT_VERSION_ID });
    await enrichPublishPromptArtifacts(msg, makeTask());

    // Verify the query uses publishedAt (not just versionNumber)
    expect(mockedDb.promptVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          promptId: PROMPT_ID,
          id: { not: DRIFT_VERSION_ID },
          publishedAt: { not: null },
        }),
        orderBy: { publishedAt: "desc" },
      }),
    );

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: {
              value: previouslyPublished.value,
              versionId: previouslyPublished.id,
              versionNumber: 1,
            },
          }),
        }),
      }),
    );
  });

  it("drift guard: ignores higher-versionNumber unpublished draft, resolves to previously-published version", async () => {
    // Regression test for the original bug: an unpublished draft at v4 must NOT be
    // selected as the baseline; only the previously-published version (v2) should be.
    //
    // Scenario: v1 published, v2 published (now previously-published), v3 unpublished draft,
    // v4 published (this artifact's version, triggering drift guard).
    const driftArtifactVersion = { id: DRIFT_VERSION_ID, value: "v4 text", versionNumber: 4, promptId: PROMPT_ID };
    // publishedAt-based query should return v2 (previously published), NOT v3 (unpublished draft).
    const previouslyPublishedV2 = { id: "pv-v2", value: "v2 text", versionNumber: 2 };

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(driftArtifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: DRIFT_VERSION_ID,
      publishedVersion: { id: DRIFT_VERSION_ID, value: "v4 text", versionNumber: 4 },
    }) as never;
    // The publishedAt query correctly skips the unpublished v3 draft and returns v2
    mockedDb.promptVersion.findFirst = vi.fn().mockResolvedValue(previouslyPublishedV2) as never;

    const msg = makeMessage({ promptVersionId: DRIFT_VERSION_ID });
    await enrichPublishPromptArtifacts(msg, makeTask());

    // Must have queried by publishedAt (not by versionNumber) to skip the unpublished draft
    expect(mockedDb.promptVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publishedAt: { not: null },
        }),
      }),
    );

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: {
              value: "v2 text",
              versionId: "pv-v2",
              versionNumber: 2,
            },
          }),
        }),
      }),
    );
  });

  it("drift guard: falls back to numeric-highest-prior when no publishedAt history exists", async () => {
    // When no version (other than the current one) has a non-null publishedAt,
    // fall back to the highest versionNumber strictly below this one.
    const driftArtifactVersion = { id: DRIFT_VERSION_ID, value: "first publish text", versionNumber: 3, promptId: PROMPT_ID };
    const priorByNumber = { id: "pv-v2", value: "draft text v2", versionNumber: 2 };

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(driftArtifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: DRIFT_VERSION_ID,
      publishedVersion: { id: DRIFT_VERSION_ID, value: "first publish text", versionNumber: 3 },
    }) as never;
    // First call (publishedAt query) returns null → no publish history
    // Second call (numeric fallback) returns priorByNumber
    mockedDb.promptVersion.findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(priorByNumber) as never;

    const msg = makeMessage({ promptVersionId: DRIFT_VERSION_ID });
    await enrichPublishPromptArtifacts(msg, makeTask());

    // Both queries should have been called
    expect(mockedDb.promptVersion.findFirst).toHaveBeenCalledTimes(2);
    // Second call: numeric fallback
    expect(mockedDb.promptVersion.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          promptId: PROMPT_ID,
          versionNumber: { lt: 3 },
        }),
        orderBy: { versionNumber: "desc" },
      }),
    );

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: {
              value: priorByNumber.value,
              versionId: priorByNumber.id,
              versionNumber: 2,
            },
          }),
        }),
      }),
    );
  });

  it("drift guard: first-ever publish (no prior version at all) sets baselineSnapshot to null", async () => {
    // Both queries return null → genuine first-ever publish → baselineSnapshot: null.
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

  it("normal branch: published version differs from artifact version — NOT redirected to drift guard", async () => {
    // Guard against the '>=' regression: when published v5 and artifact is v3,
    // the normal branch must fire (capturing publishedVersion directly), NOT the drift guard.
    const artifactVersion = { id: ARTIFACT_VERSION_ID, value: "artifact v3 text", versionNumber: 3, promptId: PROMPT_ID };
    const publishedVersion = { id: "pv-v5", value: "published v5 text", versionNumber: 5, promptId: PROMPT_ID };

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(artifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: "pv-v5",
      publishedVersion: publishedVersion,
    }) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    // findFirst must NOT have been called (drift guard must not have triggered)
    expect(mockedDb.promptVersion.findFirst).not.toHaveBeenCalled();

    // baseline must be the currently-published v5, not some prior version
    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: {
              value: "published v5 text",
              versionId: "pv-v5",
              versionNumber: 5,
            },
          }),
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
