/**
 * Unit tests for `validateHtmlArtifactsForIngest`.
 *
 * Ingest is a pointer-attach surface only. It must never become a second
 * writer that can smuggle raw markup or a cross-tenant S3 reference:
 *   1. content is a pointer (no string body, no `html`/`body`)
 *   2. `s3Key` is `orgs/{sourceControlOrgId}/…` for *this* workspace's org
 *   3. an `HtmlPage` row exists for `(orgId, slug)` with a matching s3Key
 */

import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    task: { findFirst: vi.fn() },
    feature: { findUnique: vi.fn() },
    htmlPage: { findUnique: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { ArtifactType } from "@/lib/chat";
import { validateHtmlArtifactsForIngest } from "@/lib/helpers/html-artifact-ingest";

const ORG_ID = "org-cuid-1";
const OTHER_ORG_ID = "org-cuid-other";
const TASK_ID = "task-1";
const SLUG = "my-page";
const S3_KEY = `orgs/${ORG_ID}/canvas/abc_page.html`;
const UPLOADED_AT = new Date("2024-05-06T07:08:09.000Z");

const mockTaskFindFirst = db.task.findFirst as unknown as Mock;
const mockFeatureFindUnique = db.feature.findUnique as unknown as Mock;
const mockHtmlPageFindUnique = db.htmlPage.findUnique as unknown as Mock;

function htmlArtifact(content: unknown) {
  return { type: ArtifactType.HTML, content } as never;
}

const validRow = {
  s3Key: S3_KEY,
  title: "Stored Title",
  size: 4242,
  uploadedAt: UPLOADED_AT,
};

describe("validateHtmlArtifactsForIngest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockTaskFindFirst.mockResolvedValue({
      workspace: { sourceControlOrgId: ORG_ID },
    });
    mockHtmlPageFindUnique.mockResolvedValue(validRow);
  });

  test("requires a taskId or featureId", async () => {
    const result = await validateHtmlArtifactsForIngest(
      [htmlArtifact({ s3Key: S3_KEY, slug: SLUG })],
      {},
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "taskId or featureId is required for HTML artifacts",
    });
    expect(mockHtmlPageFindUnique).not.toHaveBeenCalled();
  });

  test("400s on raw HTML string content", async () => {
    const result = await validateHtmlArtifactsForIngest(
      [htmlArtifact("<!DOCTYPE html><html><body>hi</body></html>")],
      { taskId: TASK_ID },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/not a string/i);
  });

  test("400s when content carries an `html` key", async () => {
    const result = await validateHtmlArtifactsForIngest(
      [htmlArtifact({ s3Key: S3_KEY, slug: SLUG, html: "<p>raw</p>" })],
      { taskId: TASK_ID },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/raw HTML/i);
  });

  test("400s when content carries a nested `body` key", async () => {
    const result = await validateHtmlArtifactsForIngest(
      [htmlArtifact({ s3Key: S3_KEY, slug: SLUG, page: { body: "<p>raw</p>" } })],
      { taskId: TASK_ID },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("404s when the workspace has no sourceControlOrgId", async () => {
    mockTaskFindFirst.mockResolvedValue({
      workspace: { sourceControlOrgId: null },
    });
    const result = await validateHtmlArtifactsForIngest(
      [htmlArtifact({ s3Key: S3_KEY, slug: SLUG })],
      { taskId: TASK_ID },
    );
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "HTML artifact not found",
    });
  });

  test("404s when the task does not exist", async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    const result = await validateHtmlArtifactsForIngest(
      [htmlArtifact({ s3Key: S3_KEY, slug: SLUG })],
      { taskId: TASK_ID },
    );
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "HTML artifact not found",
    });
  });

  test("404s when the s3Key belongs to a different org", async () => {
    const result = await validateHtmlArtifactsForIngest(
      [
        htmlArtifact({
          s3Key: `orgs/${OTHER_ORG_ID}/canvas/x.html`,
          slug: SLUG,
        }),
      ],
      { taskId: TASK_ID },
    );
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "HTML artifact not found",
    });
    expect(mockHtmlPageFindUnique).not.toHaveBeenCalled();
  });

  test("404s when the s3Key is workspace-scoped or unparseable", async () => {
    for (const s3Key of [
      `uploads/${ORG_ID}/swarm/task/x.html`,
      "not-a-prefix/x.html",
      "orgs",
    ]) {
      const result = await validateHtmlArtifactsForIngest(
        [htmlArtifact({ s3Key, slug: SLUG })],
        { taskId: TASK_ID },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(404);
    }
  });

  test("404s when no HtmlPage row exists for (orgId, slug)", async () => {
    mockHtmlPageFindUnique.mockResolvedValue(null);
    const result = await validateHtmlArtifactsForIngest(
      [htmlArtifact({ s3Key: S3_KEY, slug: SLUG })],
      { taskId: TASK_ID },
    );
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "HTML artifact not found",
    });
    expect(mockHtmlPageFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_slug: { orgId: ORG_ID, slug: SLUG } },
      }),
    );
  });

  test("404s when the stored row's s3Key disagrees with the pointer", async () => {
    mockHtmlPageFindUnique.mockResolvedValue({
      ...validRow,
      s3Key: `orgs/${ORG_ID}/canvas/different.html`,
    });
    const result = await validateHtmlArtifactsForIngest(
      [htmlArtifact({ s3Key: S3_KEY, slug: SLUG })],
      { taskId: TASK_ID },
    );
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "HTML artifact not found",
    });
  });

  test("accepts a valid pointer and trusts the DB row for metadata", async () => {
    const result = await validateHtmlArtifactsForIngest(
      [
        htmlArtifact({
          s3Key: S3_KEY,
          slug: SLUG,
          title: "Caller Supplied Title",
          size: 1,
          uploadedAt: "1999-01-01T00:00:00.000Z",
          bucket: "attacker-bucket",
        }),
      ],
      { taskId: TASK_ID },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pointers.size).toBe(1);
    expect(result.pointers.get(0)).toEqual({
      s3Key: S3_KEY,
      slug: SLUG,
      title: "Stored Title",
      size: 4242,
      contentType: "text/html; charset=utf-8",
      uploadedAt: UPLOADED_AT.toISOString(),
    });
  });

  test("resolves the org through a feature when featureId is given", async () => {
    mockFeatureFindUnique.mockResolvedValue({
      workspace: { sourceControlOrgId: ORG_ID },
    });
    const result = await validateHtmlArtifactsForIngest(
      [htmlArtifact({ s3Key: S3_KEY, slug: SLUG })],
      { featureId: "feature-1" },
    );
    expect(result.ok).toBe(true);
    expect(mockTaskFindFirst).not.toHaveBeenCalled();
    expect(mockFeatureFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "feature-1" } }),
    );
  });

  test("passes non-HTML artifacts through untouched", async () => {
    const result = await validateHtmlArtifactsForIngest(
      [
        { type: ArtifactType.CODE, content: { content: "console.log(1)" } } as never,
        { type: ArtifactType.BROWSER, content: { url: "https://x.test" } } as never,
      ],
      { taskId: TASK_ID },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pointers.size).toBe(0);
    expect(mockHtmlPageFindUnique).not.toHaveBeenCalled();
  });

  test("keys pointers by their index within a mixed artifact list", async () => {
    const result = await validateHtmlArtifactsForIngest(
      [
        { type: ArtifactType.CODE, content: { content: "x" } } as never,
        htmlArtifact({ s3Key: S3_KEY, slug: SLUG }),
      ],
      { taskId: TASK_ID },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.pointers.keys()]).toEqual([1]);
  });
});
