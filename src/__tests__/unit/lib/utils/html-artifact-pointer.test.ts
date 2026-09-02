/**
 * Unit tests for `validateHtmlPointerContent` (+ `extractS3KeyInfo`).
 *
 * HTML artifacts are pointers only: the body lives in S3 and Postgres
 * stores `{ s3Key, slug, ... }`. These tests pin the fail-closed
 * behaviour: no raw string body, no `html`/`body` key at any depth,
 * required `s3Key`/`slug`, allowlisted output only.
 */

import { describe, test, expect } from "vitest";
import { validateHtmlPointerContent } from "@/lib/utils/html-artifact-pointer";
import { extractS3KeyInfo } from "@/lib/utils/s3-key-info";

const ORG_ID = "org-cuid-1";
const S3_KEY = `orgs/${ORG_ID}/canvas/abc_page.html`;

function validPointer(extra: Record<string, unknown> = {}) {
  return { s3Key: S3_KEY, slug: "my-page", ...extra };
}

describe("validateHtmlPointerContent", () => {
  test("rejects a raw HTML string content", () => {
    const result = validateHtmlPointerContent(
      "<!DOCTYPE html><html><body>hi</body></html>",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not a string/i);
    }
  });

  test("rejects an empty string content", () => {
    const result = validateHtmlPointerContent("");
    expect(result.ok).toBe(false);
  });

  test("rejects null, undefined, arrays and primitives", () => {
    for (const bad of [null, undefined, [], [{ s3Key: S3_KEY, slug: "s" }], 42, true]) {
      const result = validateHtmlPointerContent(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/pointer object/i);
      }
    }
  });

  test("rejects a top-level `html` key", () => {
    const result = validateHtmlPointerContent(
      validPointer({ html: "<p>raw</p>" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/raw HTML/i);
    }
  });

  test("rejects a top-level `body` key", () => {
    const result = validateHtmlPointerContent(validPointer({ body: "<p>raw</p>" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/raw HTML/i);
    }
  });

  test("rejects `html`/`body` regardless of casing", () => {
    expect(validateHtmlPointerContent(validPointer({ HTML: "<p>x</p>" })).ok).toBe(
      false,
    );
    expect(validateHtmlPointerContent(validPointer({ Body: "<p>x</p>" })).ok).toBe(
      false,
    );
  });

  test("rejects a nested `html` key", () => {
    const result = validateHtmlPointerContent(
      validPointer({ meta: { nested: { html: "<p>raw</p>" } } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/raw HTML/i);
    }
  });

  test("rejects a `body` key nested inside an array", () => {
    const result = validateHtmlPointerContent(
      validPointer({ pages: [{ body: "<p>raw</p>" }] }),
    );
    expect(result.ok).toBe(false);
  });

  test("rejects missing or non-string s3Key", () => {
    for (const s3Key of [undefined, null, 123, {}, [], ""]) {
      const result = validateHtmlPointerContent({ slug: "my-page", s3Key });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/s3Key/);
      }
    }
  });

  test("rejects missing or non-string slug", () => {
    for (const slug of [undefined, null, 123, {}, [], ""]) {
      const result = validateHtmlPointerContent({ s3Key: S3_KEY, slug });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/slug/);
      }
    }
  });

  test("accepts a valid pointer and returns only allowlisted fields", () => {
    const uploadedAt = "2024-01-02T03:04:05.000Z";
    const result = validateHtmlPointerContent(
      validPointer({
        title: "My Page",
        size: 1234,
        uploadedAt,
        // unknown extras are dropped, not rejected
        bucket: "secret-bucket",
        presignedUrl: "https://s3.example.com/signed",
        __proto__unexpected: "x",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.pointer).sort()).toEqual([
      "contentType",
      "s3Key",
      "size",
      "slug",
      "title",
      "uploadedAt",
    ]);
    expect(result.pointer).toEqual({
      s3Key: S3_KEY,
      slug: "my-page",
      title: "My Page",
      size: 1234,
      contentType: "text/html; charset=utf-8",
      uploadedAt,
    });
  });

  test("forces contentType to text/html; charset=utf-8 even if caller lies", () => {
    const result = validateHtmlPointerContent(
      validPointer({ contentType: "application/javascript" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pointer.contentType).toBe("text/html; charset=utf-8");
  });

  test("defaults title to slug, size to 0, and uploadedAt to now", () => {
    const before = Date.now();
    const result = validateHtmlPointerContent(
      validPointer({ title: 7, size: "big", uploadedAt: 12345 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pointer.title).toBe("my-page");
    expect(result.pointer.size).toBe(0);
    const at = Date.parse(result.pointer.uploadedAt);
    expect(Number.isNaN(at)).toBe(false);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
  });

  test("drops non-finite size values", () => {
    for (const size of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validateHtmlPointerContent(validPointer({ size }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.pointer.size).toBe(0);
    }
  });
});

describe("extractS3KeyInfo", () => {
  test("parses org-scoped keys", () => {
    expect(extractS3KeyInfo(S3_KEY)).toEqual({ type: "org", id: ORG_ID });
  });

  test("parses workspace-scoped keys", () => {
    expect(extractS3KeyInfo("uploads/ws-1/swarm/task/x.png")).toEqual({
      type: "workspace",
      id: "ws-1",
    });
    expect(extractS3KeyInfo("whiteboards/ws-2/a.json")).toEqual({
      type: "workspace",
      id: "ws-2",
    });
  });

  test("returns null for unknown prefixes or too-short keys", () => {
    expect(extractS3KeyInfo("secrets/ws-1/x")).toBeNull();
    expect(extractS3KeyInfo("orgs")).toBeNull();
    expect(extractS3KeyInfo("")).toBeNull();
  });
});
