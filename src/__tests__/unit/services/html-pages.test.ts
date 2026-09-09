/**
 * Unit tests for html-pages S3 helpers and authenticated body read.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const putObject = vi.fn(async () => undefined);
const generateOrgUploadPath = vi.fn(
  (orgId: string, filename: string) => `orgs/${orgId}/canvas/abc_${filename}`,
);
const validateFileSize = vi.fn((size: number) => size <= 10 * 1024 * 1024);
const getObject = vi.fn();
const fileExists = vi.fn();

vi.mock("@/services/s3", () => ({
  getS3Service: () => ({
    putObject,
    generateOrgUploadPath,
    validateFileSize,
    getObject,
    fileExists,
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    htmlPage: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  clearHtmlPageShareRef,
  getHtmlPageBytes,
  HTML_CONTENT_TYPE,
  HtmlPageKeyError,
  HtmlPageSizeError,
  isOrgOwnedS3Key,
  mintHtmlPageShareRef,
  overwriteHtmlPageObject,
  putHtmlPageObject,
} from "@/services/html-pages";

const ORG_ID = "org-1";
const HTML = "<!DOCTYPE html><html><body>hi</body></html>";

describe("html-pages helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateOrgUploadPath.mockImplementation(
      (orgId: string, filename: string) => `orgs/${orgId}/canvas/abc_${filename}`,
    );
    validateFileSize.mockImplementation((size: number) => size <= 10 * 1024 * 1024);
    putObject.mockResolvedValue(undefined);
    fileExists.mockReturnValue(true);
  });

  test("isOrgOwnedS3Key requires orgs/{orgId}/ prefix", () => {
    expect(isOrgOwnedS3Key(ORG_ID, `orgs/${ORG_ID}/canvas/x.html`)).toBe(true);
    expect(isOrgOwnedS3Key(ORG_ID, "orgs/other/canvas/x.html")).toBe(false);
    expect(isOrgOwnedS3Key(ORG_ID, "uploads/ws/canvas/x.html")).toBe(false);
    expect(isOrgOwnedS3Key(ORG_ID, `orgs/${ORG_ID}`)).toBe(false);
    expect(isOrgOwnedS3Key(ORG_ID, `orgs/${ORG_ID}extra/canvas/x.html`)).toBe(false);
    expect(isOrgOwnedS3Key(ORG_ID, `/orgs/${ORG_ID}/canvas/x.html`)).toBe(false);
    expect(isOrgOwnedS3Key(ORG_ID, `orgs/${ORG_ID}/../other/x.html`)).toBe(false);
    expect(isOrgOwnedS3Key("foo/bar", "orgs/foo/bar/canvas/x.html")).toBe(false);
    expect(isOrgOwnedS3Key("", "orgs//canvas/x.html")).toBe(false);
  });

  test("putHtmlPageObject forces text/html and uses generateOrgUploadPath", async () => {
    const result = await putHtmlPageObject(ORG_ID, HTML, "page.html");
    expect(result.s3Key).toBe(`orgs/${ORG_ID}/canvas/abc_page.html`);
    expect(result.size).toBe(Buffer.byteLength(HTML, "utf8"));
    expect(putObject).toHaveBeenCalledWith(
      result.s3Key,
      expect.any(Buffer),
      HTML_CONTENT_TYPE,
    );
  });

  test("putHtmlPageObject refuses oversize payloads", async () => {
    validateFileSize.mockReturnValue(false);
    await expect(putHtmlPageObject(ORG_ID, HTML, "page.html")).rejects.toBeInstanceOf(
      HtmlPageSizeError,
    );
    expect(putObject).not.toHaveBeenCalled();
  });

  test("overwriteHtmlPageObject rejects a foreign key", async () => {
    await expect(
      overwriteHtmlPageObject(ORG_ID, "orgs/other/canvas/x.html", HTML),
    ).rejects.toBeInstanceOf(HtmlPageKeyError);
    expect(putObject).not.toHaveBeenCalled();
  });

  test("getHtmlPageBytes returns bytes for an org-owned row", async () => {
    const page = {
      id: "page-1",
      slug: "story",
      title: "Story",
      s3Key: `orgs/${ORG_ID}/canvas/abc_page.html`,
      size: 10,
      contentType: HTML_CONTENT_TYPE,
      uploadedAt: new Date(),
      orgId: ORG_ID,
      createdBy: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (db.htmlPage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(page);
    getObject.mockResolvedValue(Buffer.from(HTML, "utf8"));

    const result = await getHtmlPageBytes(ORG_ID, "story");
    expect(db.htmlPage.findUnique).toHaveBeenCalledWith({
      where: { orgId_slug: { orgId: ORG_ID, slug: "story" } },
      select: expect.objectContaining({
        id: true,
        slug: true,
        title: true,
        s3Key: true,
        size: true,
        contentType: true,
        uploadedAt: true,
        orgId: true,
        createdBy: true,
      }),
    });
    expect(result?.bytes.toString("utf8")).toBe(HTML);
    expect(result?.page.s3Key).toBe(page.s3Key);
  });

  test("getHtmlPageBytes never selects shareRef — it's a bearer secret", async () => {
    (db.htmlPage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "page-1",
      slug: "story",
      title: "Story",
      s3Key: `orgs/${ORG_ID}/canvas/abc_page.html`,
      size: 10,
      contentType: HTML_CONTENT_TYPE,
      uploadedAt: new Date(),
      orgId: ORG_ID,
      createdBy: "user-1",
    });
    getObject.mockResolvedValue(Buffer.from(HTML, "utf8"));

    await getHtmlPageBytes(ORG_ID, "story");
    const call = (db.htmlPage.findUnique as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.select).toBeDefined();
    expect(call.select.shareRef).toBeUndefined();

    const result = await getHtmlPageBytes(ORG_ID, "story");
    expect(result).not.toHaveProperty("page.shareRef");
    expect(Object.keys(result!.page)).not.toContain("shareRef");
  });

  test("getHtmlPageBytes returns null when mock S3 fileExists is false", async () => {
    (db.htmlPage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "page-1",
      slug: "story",
      title: "Story",
      s3Key: `orgs/${ORG_ID}/canvas/missing.html`,
      size: 10,
      contentType: HTML_CONTENT_TYPE,
      uploadedAt: new Date(),
      orgId: ORG_ID,
      createdBy: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    fileExists.mockReturnValue(false);

    const result = await getHtmlPageBytes(ORG_ID, "story");
    expect(result).toBeNull();
    expect(getObject).not.toHaveBeenCalled();
  });

  test("getHtmlPageBytes returns null for a foreign s3Key on the row", async () => {
    (db.htmlPage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "page-1",
      slug: "story",
      title: "Story",
      s3Key: "orgs/other/canvas/x.html",
      size: 10,
      contentType: HTML_CONTENT_TYPE,
      uploadedAt: new Date(),
      orgId: ORG_ID,
      createdBy: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getHtmlPageBytes(ORG_ID, "story");
    expect(result).toBeNull();
    expect(getObject).not.toHaveBeenCalled();
  });
});

describe("mintHtmlPageShareRef / clearHtmlPageShareRef", () => {
  const ORG_ID_2 = "org-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("mintHtmlPageShareRef writes a unique, sufficiently random base64url value, scoped to (id, orgId)", async () => {
    (db.htmlPage.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const shareRef = await mintHtmlPageShareRef("page-1", ORG_ID_2);

    expect(typeof shareRef).toBe("string");
    // crypto.randomBytes(24).toString("base64url") — 24 bytes encodes to
    // 32 base64url characters with no padding.
    expect(shareRef.length).toBe(32);
    expect(shareRef).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(db.htmlPage.updateMany).toHaveBeenCalledTimes(1);
    const call = (db.htmlPage.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // IDOR guard: the update is scoped to both `id` AND `orgId` — never a
    // bare `{ id }` — so a caller can't mint/overwrite a public address
    // on a row it doesn't own by supplying an id from another org.
    expect(call.where).toEqual({ id: "page-1", orgId: ORG_ID_2 });
    expect(call.data.shareRef).toBe(shareRef);
  });

  test("mintHtmlPageShareRef throws when the (id, orgId) pair matches no row (cross-org guard)", async () => {
    (db.htmlPage.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    await expect(mintHtmlPageShareRef("page-1", "some-other-org")).rejects.toThrow(
      /No HtmlPage page-1 found for this org/,
    );
    expect(db.htmlPage.updateMany).toHaveBeenCalledWith({
      where: { id: "page-1", orgId: "some-other-org" },
      data: expect.objectContaining({ shareRef: expect.any(String) }),
    });
  });

  test("mintHtmlPageShareRef retries on a shareRef unique-constraint collision", async () => {
    const collisionError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["share_ref"] } },
    );
    (db.htmlPage.updateMany as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(collisionError)
      .mockRejectedValueOnce(collisionError)
      .mockResolvedValueOnce({ count: 1 });

    const shareRef = await mintHtmlPageShareRef("page-1", ORG_ID_2);

    expect(typeof shareRef).toBe("string");
    expect(db.htmlPage.updateMany).toHaveBeenCalledTimes(3);
  });

  test("mintHtmlPageShareRef gives up after the bounded retry limit", async () => {
    const collisionError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["share_ref"] } },
    );
    (db.htmlPage.updateMany as ReturnType<typeof vi.fn>).mockRejectedValue(collisionError);

    await expect(mintHtmlPageShareRef("page-1", ORG_ID_2)).rejects.toThrow(/shareRef/);
  });

  test("mintHtmlPageShareRef rethrows a non-collision error immediately (no retry)", async () => {
    const otherError = new Prisma.PrismaClientKnownRequestError(
      "Record not found",
      { code: "P2025", clientVersion: "test" },
    );
    (db.htmlPage.updateMany as ReturnType<typeof vi.fn>).mockRejectedValue(otherError);

    await expect(mintHtmlPageShareRef("missing-page", ORG_ID_2)).rejects.toBe(otherError);
    expect(db.htmlPage.updateMany).toHaveBeenCalledTimes(1);
  });

  test("clearHtmlPageShareRef nulls the column, scoped to (id, orgId)", async () => {
    (db.htmlPage.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    await clearHtmlPageShareRef("page-1", ORG_ID_2);

    expect(db.htmlPage.updateMany).toHaveBeenCalledWith({
      where: { id: "page-1", orgId: ORG_ID_2 },
      data: { shareRef: null },
    });
  });

  test("clearHtmlPageShareRef throws when the (id, orgId) pair matches no row (cross-org guard)", async () => {
    (db.htmlPage.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    await expect(clearHtmlPageShareRef("page-1", "some-other-org")).rejects.toThrow(
      /No HtmlPage page-1 found for this org/,
    );
  });
});
