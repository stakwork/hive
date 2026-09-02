/**
 * Org-scoped HTML page storage. Postgres holds an S3 pointer only;
 * the HTML body lives in S3 under `orgs/{orgId}/canvas/...`.
 */
import crypto from "crypto";
import { Prisma } from "@prisma/client";
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
 * Public wrapper around the size ceiling so callers that need to
 * validate a byte length *before* touching S3 (e.g. `update_html`'s
 * compare-and-swap, which must know a write will succeed before it
 * commits the DB half of the CAS) don't have to reconstruct the S3
 * service themselves.
 */
export function assertHtmlSize(size: number): void {
  assertSize(getS3Service(), size);
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
  /**
   * Row-level last-write clock (Prisma `@updatedAt`). Callers that patch
   * a page (`update_html`'s edits path) capture this at read time and
   * pass it back as a compare-and-swap guard, so a concurrent write
   * that lands in between is detected instead of silently lost.
   */
  updatedAt: Date;
};

// Every row read in this file must select explicitly and omit
// `shareRef` — it is a bearer secret for a not-yet-shipped public
// link (see the schema comment on `HtmlPage.shareRef`). Never widen
// this to a bare `findUnique`/`findFirst` with no `select`, which
// would silently start returning the secret to every caller.
const HTML_PAGE_RECORD_SELECT = {
  id: true,
  slug: true,
  title: true,
  s3Key: true,
  size: true,
  contentType: true,
  uploadedAt: true,
  orgId: true,
  createdBy: true,
} as const;

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
    select: HTML_PAGE_RECORD_SELECT,
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

const SHARE_REF_BYTES = 24;
const SHARE_REF_MINT_MAX_ATTEMPTS = 5;

export class HtmlPageNotFoundError extends Error {
  constructor(id: string) {
    super(`No HtmlPage ${id} found for this org`);
    this.name = "HtmlPageNotFoundError";
  }
}

/**
 * Mint a fresh, non-guessable public address for an `HtmlPage` row and
 * persist it. Server-only — never called from a tool or from client
 * input. Not wired into any route this round; the column stays `null`
 * on all live data until a public link is actually shipped.
 *
 * `orgId` is required and the update is scoped to `{ id, orgId }` —
 * never a bare `{ id }` — so a future caller can't mint (or overwrite)
 * a public address on a row belonging to a different org by passing an
 * `id` it doesn't own. Throws `HtmlPageNotFoundError` when the row
 * doesn't exist under that org (`updateMany` count === 0) rather than
 * silently no-oping.
 *
 * Retries a bounded number of times on a unique-constraint collision
 * (`P2002` on `shareRef`), which is astronomically unlikely at 24
 * random bytes but handled defensively rather than assumed away.
 */
export async function mintHtmlPageShareRef(id: string, orgId: string): Promise<string> {
  for (let attempt = 0; attempt < SHARE_REF_MINT_MAX_ATTEMPTS; attempt++) {
    const shareRef = crypto.randomBytes(SHARE_REF_BYTES).toString("base64url");
    try {
      const { count } = await db.htmlPage.updateMany({
        where: { id, orgId },
        data: { shareRef },
      });
      if (count === 0) {
        throw new HtmlPageNotFoundError(id);
      }
      return shareRef;
    } catch (e) {
      if (e instanceof HtmlPageNotFoundError) {
        throw e;
      }
      const isCollision =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        Array.isArray(e.meta?.target) &&
        (e.meta.target as string[]).includes("share_ref");
      if (!isCollision) {
        throw e;
      }
      // Collision on `shareRef` itself — retry with a freshly generated
      // value. Any other constraint failure (e.g. bad `id`) rethrows.
    }
  }
  throw new Error(
    `Failed to mint a unique shareRef for HtmlPage ${id} after ${SHARE_REF_MINT_MAX_ATTEMPTS} attempts`,
  );
}

/**
 * Revoke an `HtmlPage`'s public address by clearing `shareRef` back to
 * `null`. Server-only, symmetric with `mintHtmlPageShareRef`.
 *
 * `orgId` is required and the update is scoped to `{ id, orgId }` for
 * the same reason as `mintHtmlPageShareRef`: a bare `{ id }` would let
 * a caller revoke (or, combined with a bad `id` guess, no-op against)
 * another org's row. Throws `HtmlPageNotFoundError` when the row isn't
 * found under that org.
 */
export async function clearHtmlPageShareRef(id: string, orgId: string): Promise<void> {
  const { count } = await db.htmlPage.updateMany({
    where: { id, orgId },
    data: { shareRef: null },
  });
  if (count === 0) {
    throw new HtmlPageNotFoundError(id);
  }
}
