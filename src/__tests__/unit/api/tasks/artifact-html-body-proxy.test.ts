/**
 * Unit tests for GET /api/tasks/[taskId]/artifacts/[artifactId]/html
 *
 * Task-scoped body proxy: HTML-only, workspace members only, and the S3
 * object is always resolved from the HtmlPage row via the pointer slug —
 * never from a caller-supplied `s3Key`. Bytes are an opaque download.
 */

import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  db: { artifact: { findUnique: vi.fn() } },
}));
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(),
}));
vi.mock("@/services/html-pages", () => ({ getHtmlPageBytes: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { ArtifactType } from "@prisma/client";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { getHtmlPageBytes } from "@/services/html-pages";
import { GET } from "@/app/api/tasks/[taskId]/artifacts/[artifactId]/html/route";

const mockSession = getServerSession as unknown as Mock;
const mockArtifactFindUnique = db.artifact.findUnique as unknown as Mock;
const mockAccess = validateWorkspaceAccessById as unknown as Mock;
const mockGetBytes = getHtmlPageBytes as unknown as Mock;

const TASK_ID = "task-1";
const ARTIFACT_ID = "artifact-1";
const WORKSPACE_ID = "ws-1";
const ORG_ID = "org-cuid-1";
const SLUG = "my-page";
const HTML = "<!DOCTYPE html><html><body>hello</body></html>";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/tasks/${TASK_ID}/artifacts/${ARTIFACT_ID}/html`,
    { method: "GET" },
  );
}

const params = {
  params: Promise.resolve({ taskId: TASK_ID, artifactId: ARTIFACT_ID }),
};

function artifactRow(overrides: Record<string, unknown> = {}) {
  return {
    type: ArtifactType.HTML,
    content: { slug: SLUG, s3Key: `orgs/${ORG_ID}/canvas/x.html` },
    message: {
      task: {
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        workspace: { sourceControlOrgId: ORG_ID },
      },
    },
    ...overrides,
  };
}

describe("GET /api/tasks/[taskId]/artifacts/[artifactId]/html", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSession.mockResolvedValue({ user: { id: "user-1" } });
    mockArtifactFindUnique.mockResolvedValue(artifactRow());
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true });
    mockGetBytes.mockResolvedValue({
      page: { slug: SLUG, s3Key: `orgs/${ORG_ID}/canvas/x.html` },
      bytes: Buffer.from(HTML, "utf8"),
    });
  });

  test("401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(null);
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockArtifactFindUnique).not.toHaveBeenCalled();
  });

  test("404 when the artifact does not exist", async () => {
    mockArtifactFindUnique.mockResolvedValue(null);
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Not found" });
  });

  test("404 for a non-HTML artifact type", async () => {
    mockArtifactFindUnique.mockResolvedValue(
      artifactRow({ type: ArtifactType.CODE }),
    );
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  test("404 when the artifact belongs to a different task", async () => {
    mockArtifactFindUnique.mockResolvedValue(
      artifactRow({
        message: {
          task: {
            id: "other-task",
            workspaceId: WORKSPACE_ID,
            workspace: { sourceControlOrgId: ORG_ID },
          },
        },
      }),
    );
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  test("404 without workspace access", async () => {
    mockAccess.mockResolvedValue({ hasAccess: false, canRead: false });
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    expect(mockGetBytes).not.toHaveBeenCalled();
    expect(mockAccess).toHaveBeenCalledWith(WORKSPACE_ID, "user-1");
  });

  test("404 when the member cannot read", async () => {
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: false });
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  test("404 when the workspace has no linked org", async () => {
    mockArtifactFindUnique.mockResolvedValue(
      artifactRow({
        message: {
          task: {
            id: TASK_ID,
            workspaceId: WORKSPACE_ID,
            workspace: { sourceControlOrgId: null },
          },
        },
      }),
    );
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  test("404 when the pointer has no usable slug", async () => {
    for (const content of [
      null,
      {},
      { slug: "" },
      { slug: 42 },
      { s3Key: `orgs/${ORG_ID}/canvas/x.html` },
    ]) {
      mockArtifactFindUnique.mockResolvedValue(artifactRow({ content }));
      const res = await GET(makeRequest(), params);
      expect(res.status).toBe(404);
    }
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  test("404 when the page row or S3 object is missing", async () => {
    mockGetBytes.mockResolvedValue(null);
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Not found" });
  });

  test("200 returns the bytes with opaque-download headers", async () => {
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString("utf8")).toBe(HTML);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const contentType = res.headers.get("Content-Type") ?? "";
    expect(contentType).not.toMatch(/html/i);
  });

  test("resolves the object via (orgId, slug) and ignores a caller-supplied s3Key", async () => {
    mockArtifactFindUnique.mockResolvedValue(
      artifactRow({
        content: {
          slug: SLUG,
          // A hostile pointer key must not be used for the read.
          s3Key: "orgs/attacker-org/canvas/evil.html",
        },
      }),
    );
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(200);
    expect(mockGetBytes).toHaveBeenCalledTimes(1);
    expect(mockGetBytes).toHaveBeenCalledWith(ORG_ID, SLUG);
    const [[, passedSlug]] = mockGetBytes.mock.calls;
    expect(passedSlug).toBe(SLUG);
    for (const call of mockGetBytes.mock.calls) {
      expect(call).not.toContain("orgs/attacker-org/canvas/evil.html");
    }
  });

  test("does not redirect to a presigned S3 URL", async () => {
    const res = await GET(makeRequest(), params);
    expect(res.headers.get("Location")).toBeNull();
  });
});
