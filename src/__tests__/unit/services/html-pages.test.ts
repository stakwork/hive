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
    htmlPage: { findUnique: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import {
  getHtmlPageBytes,
  HTML_CONTENT_TYPE,
  HtmlPageKeyError,
  HtmlPageSizeError,
  isOrgOwnedS3Key,
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
    });
    expect(result?.bytes.toString("utf8")).toBe(HTML);
    expect(result?.page.s3Key).toBe(page.s3Key);
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
