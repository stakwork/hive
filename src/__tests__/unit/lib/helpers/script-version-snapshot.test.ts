// @vitest-environment node
/**
 * Unit tests for enrichPublishScriptArtifacts.
 *
 * Tests cover:
 * - Happy path: this version captured, published version as baseline
 * - Chain baseline: the previous PUBLISH_SCRIPT artifact in the task wins
 * - Drift guard: published_version_id already points at this artifact's own
 *   version → fall back to the version below it, so a published change never
 *   diffs against itself
 * - Never-published script → positional "prior" baseline
 * - First-ever version → baselineSnapshot: null
 * - Workspace gating, idempotency, and no script source in logs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db");
vi.mock("@/lib/logger");
vi.mock("@/config/env", () => ({
  config: { STAKWORK_BASE_URL: "https://api.stakwork.test/api/v1", STAKWORK_API_KEY: "test-key" },
}));

import { enrichPublishScriptArtifacts } from "@/lib/helpers/script-version-snapshot";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ArtifactType } from "@/lib/chat";
import { Prisma } from "@prisma/client";

const mockedDb = vi.mocked(db);
const mockedLogger = vi.mocked(logger);

// ── Shared fixtures ────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-stakwork";
const TASK_ID = "task-1";
const SCRIPT_ID = 364;
const ARTIFACT_ID = "artifact-1";
const MSG_ID = "msg-1";

function makeTask() {
  return { id: TASK_ID, workspaceId: WORKSPACE_ID };
}

function makeMessage(content: Record<string, unknown> = {}) {
  return {
    id: MSG_ID,
    taskId: TASK_ID,
    artifacts: [
      {
        id: ARTIFACT_ID,
        type: ArtifactType.PUBLISH_SCRIPT as string,
        content: {
          scriptId: SCRIPT_ID,
          scriptVersionId: 303,
          scriptName: "filter_13f_by_date",
          published: false,
          ...content,
        } as Prisma.JsonValue,
      },
    ],
  };
}

/** A prior enriched PUBLISH_SCRIPT artifact row, as resolveBaselineSnapshot reads it. */
function makePriorArtifact(o: {
  scriptId?: number;
  scriptVersionId: number;
  value: string;
  versionNumber: number;
}) {
  return {
    id: `prior-${o.scriptVersionId}`,
    content: {
      scriptId: o.scriptId ?? SCRIPT_ID,
      scriptVersionId: o.scriptVersionId,
      versionSnapshot: { value: o.value, versionNumber: o.versionNumber },
    } as Prisma.JsonValue,
  };
}

/**
 * Routes Stakwork GETs to canned payloads.
 *   versions:  versionId → { version_number, source_code }
 *   published: the script's published_version_id
 */
function mockStakwork(opts: {
  versions: Record<number, { version_number: number; source_code: string }>;
  publishedVersionId?: number | null;
}) {
  const fetchMock = vi.fn(async (url: string) => {
    const ok = (data: unknown) => ({
      ok: true,
      json: async () => ({ success: true, data }),
      text: async () => "",
    });

    const versionMatch = url.match(/\/scripts\/\d+\/versions\/(\d+)$/);
    if (versionMatch) {
      const versionId = Number(versionMatch[1]);
      const version = opts.versions[versionId];
      if (!version) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
      }
      return ok({ id: SCRIPT_ID, version_id: versionId, ...version });
    }

    if (/\/scripts\/\d+\/versions$/.test(url)) {
      return ok({
        versions: Object.entries(opts.versions).map(([id, v]) => ({
          id: Number(id),
          version_number: v.version_number,
        })),
      });
    }

    if (/\/scripts\/\d+$/.test(url)) {
      return ok({ id: SCRIPT_ID, published_version_id: opts.publishedVersionId ?? null });
    }

    throw new Error(`unexpected url: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const THREE_VERSIONS = {
  301: { version_number: 1, source_code: "v1 source" },
  302: { version_number: 2, source_code: "v2 source" },
  303: { version_number: 3, source_code: "v3 source" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.spyOn(console, "error").mockImplementation(() => {});

  mockedDb.workspace.findFirst = vi.fn().mockResolvedValue({ id: WORKSPACE_ID }) as never;
  mockedDb.artifact.findMany = vi.fn().mockResolvedValue([]) as never;
  mockedDb.artifact.update = vi.fn().mockResolvedValue({}) as never;
});

/** The content written by the single artifact.update call. */
function persistedContent(): Record<string, unknown> {
  const calls = (mockedDb.artifact.update as unknown as { mock: { calls: [{ data: { content: Record<string, unknown> } }][] } }).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0].data.content;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("enrichPublishScriptArtifacts", () => {
  it("happy path: captures this version and the published version as baseline", async () => {
    mockStakwork({ versions: THREE_VERSIONS, publishedVersionId: 302 });

    await enrichPublishScriptArtifacts(makeMessage(), makeTask());

    expect(persistedContent()).toMatchObject({
      versionSnapshot: { value: "v3 source", versionNumber: 3 },
      baselineSnapshot: {
        value: "v2 source",
        versionId: 302,
        versionNumber: 2,
        source: "published",
      },
    });
  });

  it("chain: a later artifact is measured against the previous artifact, not the published version", async () => {
    mockStakwork({ versions: THREE_VERSIONS, publishedVersionId: 301 });
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      makePriorArtifact({ scriptVersionId: 302, value: "v2 source", versionNumber: 2 }),
    ]) as never;

    await enrichPublishScriptArtifacts(makeMessage(), makeTask());

    expect(persistedContent().baselineSnapshot).toEqual({
      value: "v2 source",
      versionId: 302,
      versionNumber: 2,
      source: "chain",
    });
  });

  it("chain: ignores artifacts for other scripts and versions at or above this one", async () => {
    mockStakwork({ versions: THREE_VERSIONS, publishedVersionId: 301 });
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([
      makePriorArtifact({ scriptId: 999, scriptVersionId: 302, value: "other", versionNumber: 2 }),
      makePriorArtifact({ scriptVersionId: 303, value: "same version", versionNumber: 3 }),
    ]) as never;

    await enrichPublishScriptArtifacts(makeMessage(), makeTask());

    // Neither prior qualifies → falls through to the published version (v1).
    expect(persistedContent().baselineSnapshot).toMatchObject({
      versionNumber: 1,
      source: "published",
    });
  });

  it("drift guard: published version is this artifact's own → baseline is the version below", async () => {
    // This is the case that made a published change read as "no changes detected".
    mockStakwork({ versions: THREE_VERSIONS, publishedVersionId: 303 });

    await enrichPublishScriptArtifacts(makeMessage(), makeTask());

    expect(persistedContent().baselineSnapshot).toEqual({
      value: "v2 source",
      versionId: 302,
      versionNumber: 2,
      source: "prior",
    });
  });

  it("never-published script: baseline is the version immediately below", async () => {
    mockStakwork({ versions: THREE_VERSIONS, publishedVersionId: null });

    await enrichPublishScriptArtifacts(makeMessage(), makeTask());

    expect(persistedContent().baselineSnapshot).toMatchObject({
      versionNumber: 2,
      source: "prior",
    });
  });

  it("first-ever version: baselineSnapshot is null", async () => {
    mockStakwork({
      versions: { 301: { version_number: 1, source_code: "v1 source" } },
      publishedVersionId: null,
    });

    await enrichPublishScriptArtifacts(
      makeMessage({ scriptVersionId: 301 }),
      makeTask(),
    );

    expect(persistedContent()).toMatchObject({
      versionSnapshot: { value: "v1 source", versionNumber: 1 },
      baselineSnapshot: null,
    });
  });

  it("batch: artifacts are enriched oldest version first so the chain links up", async () => {
    mockStakwork({ versions: THREE_VERSIONS, publishedVersionId: 301 });

    const message = {
      id: MSG_ID,
      taskId: TASK_ID,
      artifacts: [
        {
          id: "artifact-v3",
          type: ArtifactType.PUBLISH_SCRIPT as string,
          content: { scriptId: SCRIPT_ID, scriptVersionId: 303 } as Prisma.JsonValue,
        },
        {
          id: "artifact-v2",
          type: ArtifactType.PUBLISH_SCRIPT as string,
          content: { scriptId: SCRIPT_ID, scriptVersionId: 302 } as Prisma.JsonValue,
        },
      ],
    };

    const persisted: Array<{ id: string; content: Record<string, unknown> }> = [];
    mockedDb.artifact.findMany = vi.fn().mockImplementation(async () =>
      persisted.map((p) => ({ id: p.id, content: p.content as Prisma.JsonValue })),
    ) as never;
    mockedDb.artifact.update = vi.fn().mockImplementation(async ({ where, data }) => {
      persisted.push({ id: where.id, content: data.content });
      return {};
    }) as never;

    await enrichPublishScriptArtifacts(message, makeTask());

    expect(persisted.map((p) => p.id)).toEqual(["artifact-v2", "artifact-v3"]);
    expect(persisted[0].content.baselineSnapshot).toMatchObject({ source: "published" });
    expect(persisted[1].content.baselineSnapshot).toMatchObject({
      versionNumber: 2,
      source: "chain",
    });
  });

  it("workspace gating: skips entirely when the task is not in the stakwork workspace", async () => {
    const fetchMock = mockStakwork({ versions: THREE_VERSIONS, publishedVersionId: 302 });
    mockedDb.workspace.findFirst = vi.fn().mockResolvedValue(null) as never;

    await enrichPublishScriptArtifacts(makeMessage(), makeTask());

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("idempotent: skips artifacts that already carry a versionSnapshot", async () => {
    const fetchMock = mockStakwork({ versions: THREE_VERSIONS, publishedVersionId: 302 });

    await enrichPublishScriptArtifacts(
      makeMessage({ versionSnapshot: { value: "already captured", versionNumber: 3 } }),
      makeTask(),
    );

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the artifact unenriched when Stakwork cannot serve the version", async () => {
    mockStakwork({ versions: { 301: { version_number: 1, source_code: "v1" } } });

    await enrichPublishScriptArtifacts(makeMessage({ scriptVersionId: 999 }), makeTask());

    expect(mockedDb.artifact.update).not.toHaveBeenCalled();
  });

  it("never writes script source to the logs", async () => {
    const SECRET = "SUPER_SECRET_SCRIPT_BODY";
    mockStakwork({
      versions: {
        301: { version_number: 1, source_code: `baseline ${SECRET}` },
        303: { version_number: 3, source_code: `current ${SECRET}` },
      },
      publishedVersionId: 301,
    });

    await enrichPublishScriptArtifacts(makeMessage(), makeTask());

    const allCalls = [
      ...mockedLogger.info.mock.calls,
      ...mockedLogger.warn.mock.calls,
      ...mockedLogger.error.mock.calls,
      ...(console.error as ReturnType<typeof vi.spyOn>).mock.calls,
    ];
    for (const args of allCalls) {
      expect(JSON.stringify(args)).not.toContain(SECRET);
    }
  });
});
