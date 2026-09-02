/**
 * Org-scoped HTML page storage. Postgres holds an S3 pointer only;
 * the HTML body lives in S3 under `orgs/{orgId}/canvas/...`.
 */
import { db } from "@/lib/db";
import { getS3Service } from "@/services/s3";

export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

export function orgS3KeyPrefix(orgId: string): string {
  return `orgs/${orgId}/`;
}

/**
 * True when `s3Key` is owned by `orgId` as path segments
 * (`orgs/{orgId}/…`). Rejects empty ids, embedded slashes, `..`,
 * and prefix-sibling keys (`orgs/foo` vs `orgs/foobar/…`).
 */
export function isOrgOwnedS3Key(orgId: string, s3Key: string): boolean {
  if (!orgId || orgId.includes("/") || orgId.includes("\\") || orgId.includes("..")) {
    return false;
  }
  if (!s3Key || s3Key.includes("\\") || s3Key.startsWith("/")) {
    return false;
  }
  const parts = s3Key.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    return false;
  }
  return parts[0] === "orgs" && parts[1] === orgId && parts.length >= 3;
}

export class HtmlPageSizeError extends Error {
  constructor() {
    super("HTML exceeds the 10MB size limit");
    this.name = "HtmlPageSizeError";
  }
}

export class HtmlPageKeyError extends Error {
  constructor(message = "s3Key is not owned by this org") {
    super(message);
    this.name = "HtmlPageKeyError";
  }
}

function htmlBuffer(html: string): Buffer {
  return Buffer.from(html, "utf8");
}

function assertSize(s3: ReturnType<typeof getS3Service>, size: number): void {
  if (!s3.validateFileSize(size)) {
    throw new HtmlPageSizeError();
  }
}

/**
 * Upload a new HTML object. Org id is taken from the caller (never a
 * tool argument). Forces `Content-Type: text/html; charset=utf-8`.
 */
export async function putHtmlPageObject(
  orgId: string,
  html: string,
  filename: string,
): Promise<{ s3Key: string; size: number }> {
  const s3 = getS3Service();
  const buffer = htmlBuffer(html);
  assertSize(s3, buffer.length);
  const s3Key = s3.generateOrgUploadPath(orgId, filename);
  if (!isOrgOwnedS3Key(orgId, s3Key)) {
    throw new HtmlPageKeyError("Generated S3 key is not org-scoped");
  }
  await s3.putObject(s3Key, buffer, HTML_CONTENT_TYPE);
  return { s3Key, size: buffer.length };
}

/**
 * Overwrite an existing HTML object at the same key. Rejects keys that
 * are not prefixed `orgs/{orgId}/`.
 */
export async function overwriteHtmlPageObject(
  orgId: string,
  s3Key: string,
  html: string,
): Promise<{ size: number }> {
  if (!isOrgOwnedS3Key(orgId, s3Key)) {
    throw new HtmlPageKeyError();
  }
  const s3 = getS3Service();
  const buffer = htmlBuffer(html);
  assertSize(s3, buffer.length);
  await s3.putObject(s3Key, buffer, HTML_CONTENT_TYPE);
  return { size: buffer.length };
}

export type HtmlPageRecord = {
  id: string;
  slug: string;
  title: string;
  s3Key: string;
  size: number;
  contentType: string;
  uploadedAt: Date;
  orgId: string;
  createdBy: string;
};

/**
 * Authenticated (not presigned) body read. Loads the row scoped to
 * `orgId` + `slug`, verifies the stored key belongs to that org, and
 * returns the raw HTML bytes. Returns `null` when the row is missing,
 * the key is foreign, or the S3 object is absent (mock `fileExists`).
 */
export async function getHtmlPageBytes(
  orgId: string,
  slug: string,
): Promise<{ page: HtmlPageRecord; bytes: Buffer } | null> {
  const page = await db.htmlPage.findUnique({
    where: { orgId_slug: { orgId, slug } },
  });
  if (!page || page.orgId !== orgId) {
    return null;
  }
  if (!isOrgOwnedS3Key(orgId, page.s3Key)) {
    return null;
  }
  const s3 = getS3Service();
  const fileExists = (s3 as { fileExists?: (key: string) => boolean }).fileExists;
  if (typeof fileExists === "function" && !fileExists(page.s3Key)) {
    return null;
  }
  try {
    const bytes = await s3.getObject(page.s3Key);
    return { page, bytes };
  } catch {
    return null;
  }
}
