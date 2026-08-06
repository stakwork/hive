// @vitest-environment node
/**
 * Unit tests for enrichPublishPromptArtifacts.
 *
 * Tests cover:
 * - Happy path baseline capture
 * - Chain baseline: the previous PUBLISH_PROMPT artifact in the task wins over
 *   the published version, and the first artifact still uses the published one
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

  // Default: no earlier PUBLISH_PROMPT artifacts in the task → no chain baseline
  mockedDb.artifact.findMany = vi.fn().mockResolvedValue([]) as never;

  // Default: batch ordering lookup returns nothing (single-artifact messages skip it)
  mockedDb.promptVersion.findMany = vi.fn().mockResolvedValue([]) as never;
});

/** A prior enriched PUBLISH_PROMPT artifact row, as resolveChainBaseline reads it. */
function makePriorArtifact(overrides: {
  id?: string;
  promptId?: string;
  promptVersionId: string;
  value: string;
  versionNumber: number;
}) {
  return {
    id: overrides.id ?? `prior-${overrides.promptVersionId}`,
    content: {
      promptId: overrides.promptId ?? PROMPT_ID,
      promptVersionId: overrides.promptVersionId,
      versionSnapshot: { value: overrides.value, versionNumber: overrides.versionNumber },
    } as Prisma.JsonValue,
  };
}

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
              source: "published",
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

  it("chain: a later artifact is measured against the previous artifact, not the published version", async () => {
    // The task already produced v2 (captured). This artifact is v3, so its baseline
    // is v2 — the change immediately before it — even though v1 is still published.
    const artifactVersion = { id: "pv-v3", value: "v3 text", versionNumber: 3, promptId: PROMPT_ID };

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(artifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: PUBLISHED_VERSION_ID,
      publishedVersion: makePublishedVersion(),
    }) as never;
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      makePriorArtifact({ promptVersionId: "pv-v2", value: "v2 text", versionNumber: 2 }),
    ]) as never;

    await enrichPublishPromptArtifacts(makeMessage({ promptVersionId: "pv-v3" }), makeTask());

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: {
              value: "v2 text",
              versionId: "pv-v2",
              versionNumber: 2,
              source: "chain",
            },
          }),
        }),
      }),
    );
  });

  it("chain: picks the nearest earlier version and ignores later ones", async () => {
    // Prior artifacts at v2, v4 and v9; this artifact is v5. Only v4 may be the
    // baseline — v2 is not the nearest and v9 is not earlier at all.
    const artifactVersion = { id: "pv-v5", value: "v5 text", versionNumber: 5, promptId: PROMPT_ID };

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(artifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: PUBLISHED_VERSION_ID,
      publishedVersion: makePublishedVersion(),
    }) as never;
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      makePriorArtifact({ promptVersionId: "pv-v9", value: "v9 text", versionNumber: 9 }),
      makePriorArtifact({ promptVersionId: "pv-v2", value: "v2 text", versionNumber: 2 }),
      makePriorArtifact({ promptVersionId: "pv-v4", value: "v4 text", versionNumber: 4 }),
    ]) as never;

    await enrichPublishPromptArtifacts(makeMessage({ promptVersionId: "pv-v5" }), makeTask());

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: expect.objectContaining({ versionId: "pv-v4", source: "chain" }),
          }),
        }),
      }),
    );
  });

  it("chain: ignores earlier artifacts belonging to a different prompt", async () => {
    // Another prompt changed earlier in the same task — it must never become the
    // baseline for this one, which is still its first change (published wins).
    const publishedVersion = makePublishedVersion();
    const artifactVersion = makeArtifactVersion();

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(artifactVersion) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: PUBLISHED_VERSION_ID,
      publishedVersion,
    }) as never;
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      makePriorArtifact({
        promptId: "some-other-prompt",
        promptVersionId: "other-v1",
        value: "other prompt text",
        versionNumber: 1,
      }),
    ]) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: {
              value: publishedVersion.value,
              versionId: PUBLISHED_VERSION_ID,
              versionNumber: 1,
              source: "published",
            },
          }),
        }),
      }),
    );
  });

  it("chain: ignores earlier artifacts that were never enriched", async () => {
    // An artifact with no versionSnapshot has no captured text, so it cannot be a
    // baseline — the published version is used instead.
    const publishedVersion = makePublishedVersion();

    mockedDb.promptVersion.findUnique = vi.fn().mockResolvedValue(makeArtifactVersion()) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: PUBLISHED_VERSION_ID,
      publishedVersion,
    }) as never;
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      {
        id: "prior-unenriched",
        content: { promptId: PROMPT_ID, promptVersionId: "pv-v1" } as Prisma.JsonValue,
      },
    ]) as never;

    await enrichPublishPromptArtifacts(makeMessage(), makeTask());

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            baselineSnapshot: expect.objectContaining({
              versionId: PUBLISHED_VERSION_ID,
              source: "published",
            }),
          }),
        }),
      }),
    );
  });

  it("chain: a batch of artifacts is enriched oldest version first", async () => {
    // Two artifacts arrive in one payload, newest first. They must be walked in
    // version order so the older one is captured before the newer one looks for it.
    const message = {
      id: MSG_ID,
      taskId: TASK_ID,
      artifacts: [
        {
          id: "artifact-v3",
          type: ArtifactType.PUBLISH_PROMPT as string,
          content: { promptId: PROMPT_ID, promptVersionId: "pv-v3" } as Prisma.JsonValue,
        },
        {
          id: "artifact-v2",
          type: ArtifactType.PUBLISH_PROMPT as string,
          content: { promptId: PROMPT_ID, promptVersionId: "pv-v2" } as Prisma.JsonValue,
        },
      ],
    };

    mockedDb.promptVersion.findMany = vi.fn().mockResolvedValue([
      { id: "pv-v3", versionNumber: 3 },
      { id: "pv-v2", versionNumber: 2 },
    ]) as never;
    mockedDb.promptVersion.findUnique = vi.fn().mockImplementation(async ({ where }) =>
      where.id === "pv-v2"
        ? { id: "pv-v2", value: "v2 text", versionNumber: 2, promptId: PROMPT_ID }
        : { id: "pv-v3", value: "v3 text", versionNumber: 3, promptId: PROMPT_ID },
    ) as never;
    mockedDb.prompt.findUnique = vi.fn().mockResolvedValue({
      id: PROMPT_ID,
      publishedVersionId: PUBLISHED_VERSION_ID,
      publishedVersion: makePublishedVersion(),
    }) as never;

    // The v2 artifact is persisted first, so by the time v3 is enriched the chain
    // lookup can see it.
    const persisted: Array<{ id: string; content: Prisma.JsonValue }> = [];
    mockedDb.artifact.findMany = vi.fn().mockImplementation(async () => persisted) as never;
    mockedDb.artifact.update = vi.fn().mockImplementation(async ({ where, data }) => {
      persisted.push({ id: where.id, content: data.content });
      return {};
    }) as never;

    await enrichPublishPromptArtifacts(message, makeTask());

    expect(persisted.map((p) => p.id)).toEqual(["artifact-v2", "artifact-v3"]);

    const v2Content = persisted[0].content as Record<string, unknown>;
    const v3Content = persisted[1].content as Record<string, unknown>;

    // First change → published baseline; second change → the first change.
    expect(v2Content.baselineSnapshot).toMatchObject({ source: "published", versionNumber: 1 });
    expect(v3Content.baselineSnapshot).toMatchObject({
      value: "v2 text",
      versionId: "pv-v2",
      versionNumber: 2,
      source: "chain",
    });
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
              source: "published",
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
              source: "published",
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
              source: "published",
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
              source: "published",
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
