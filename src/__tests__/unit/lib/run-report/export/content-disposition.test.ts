import { describe, it, expect } from "vitest";
import { buildContentDisposition } from "@/lib/run-report/export/content-disposition";

describe("buildContentDisposition", () => {
  describe("basic structure", () => {
    it("returns an attachment disposition", () => {
      const result = buildContentDisposition("My Report", "my-report");
      expect(result).toMatch(/^attachment;/);
    });

    it("includes both filename= and filename*= parts", () => {
      const result = buildContentDisposition("My Report", "my-report");
      expect(result).toContain('filename="');
      expect(result).toContain("filename*=UTF-8''");
    });

    it("uses the fallback slug as the ASCII filename", () => {
      const result = buildContentDisposition("My Report", "my-report");
      expect(result).toContain('filename="my-report"');
    });
  });

  describe("header injection prevention (CR/LF/control chars)", () => {
    it("strips CR from the title", () => {
      const result = buildContentDisposition("bad\rfield", "slug");
      expect(result).not.toContain("\r");
      const lines = result.split("\r");
      expect(lines).toHaveLength(1);
    });

    it("strips LF from the title", () => {
      const result = buildContentDisposition("bad\nfield", "slug");
      expect(result).not.toContain("\n");
      const lines = result.split("\n");
      expect(lines).toHaveLength(1);
    });

    it("strips CRLF sequence from the title", () => {
      const result = buildContentDisposition("inject\r\nX-Evil: header", "slug");
      expect(result).not.toContain("\r");
      expect(result).not.toContain("\n");
    });

    it("strips double-quotes from title to prevent quoted-string breakout", () => {
      const result = buildContentDisposition('title"with"quotes', "slug");
      expect(result).not.toMatch(/filename="[^"]*"[^;]/); // no extra quotes mid-value
    });

    it("strips C0 control characters", () => {
      const result = buildContentDisposition("title\x01\x1f\x00end", "slug");
      expect(result).not.toMatch(/[\x00-\x1F]/);
    });

    it("strips DEL (0x7F)", () => {
      const result = buildContentDisposition("title\x7fend", "slug");
      expect(result).not.toContain("\x7f");
    });

    it("strips C1 control characters", () => {
      const result = buildContentDisposition("title\x80\x9fend", "slug");
      expect(result).not.toMatch(/[\x80-\x9F]/);
    });

    it("produces exactly one line regardless of embedded newlines", () => {
      const result = buildContentDisposition(
        "Report\r\nX-Injected: evil\r\nX-Other: bad",
        "slug",
      );
      const lines = result.split(/\r?\n/);
      expect(lines).toHaveLength(1);
    });
  });

  describe("fallback slug handling", () => {
    it("uses 'report' when both title and slug produce empty ASCII", () => {
      // Slug with only non-ASCII characters strips to empty → fallback
      const result = buildContentDisposition("", "");
      expect(result).toContain('filename="report"');
    });

    it("strips non-ASCII from the fallback slug", () => {
      const result = buildContentDisposition("", "réport");
      // Non-ASCII stripped → 'rport' or similar, not the raw value
      expect(result).not.toContain("é");
    });

    it("uses title in the RFC5987 segment even when slug is plain", () => {
      const result = buildContentDisposition("My Great Report", "run-123");
      expect(result).toContain('filename="run-123"');
      expect(result).toContain("filename*=UTF-8''");
    });
  });

  describe("non-ASCII / RFC 5987 encoding", () => {
    it("percent-encodes non-ASCII characters in filename*", () => {
      const result = buildContentDisposition("Müller Report", "muller-report");
      // ü is U+00FC → UTF-8 0xC3 0xBC → %C3%BC
      expect(result).toContain("%C3%BC");
    });

    it("handles Chinese characters", () => {
      const result = buildContentDisposition("法律报告", "legal-report");
      expect(result).toContain("filename*=UTF-8''");
      // Should contain percent-encoded bytes, not raw Chinese
      const rfc5987Part = result.match(/filename\*=UTF-8''(.+)$/)?.[1] ?? "";
      expect(rfc5987Part).not.toMatch(/[\u4e00-\u9fff]/);
      expect(rfc5987Part).toMatch(/%[0-9A-F]{2}/);
    });

    it("handles emoji in the title", () => {
      const result = buildContentDisposition("Report 🎉", "report");
      expect(result).toContain("filename*=UTF-8''");
      const rfc5987Part = result.match(/filename\*=UTF-8''(.+)$/)?.[1] ?? "";
      expect(rfc5987Part).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
    });

    it("preserves safe ASCII characters without encoding", () => {
      const result = buildContentDisposition("report-2024.pdf", "report-2024.pdf");
      const rfc5987Part = result.match(/filename\*=UTF-8''(.+)$/)?.[1] ?? "";
      // ALPHA, DIGIT, -, . are attr-chars and should not be percent-encoded
      expect(rfc5987Part).toContain("report-2024.pdf");
    });
  });

  describe("well-formed output", () => {
    it("the ASCII filename value is properly quoted", () => {
      const result = buildContentDisposition("My Report", "my-report");
      expect(result).toMatch(/filename="[^"]*"/);
    });

    it("produces a semicolon-separated header value", () => {
      const result = buildContentDisposition("Report", "slug");
      const parts = result.split(";").map((p) => p.trim());
      expect(parts[0]).toBe("attachment");
      expect(parts.some((p) => p.startsWith("filename="))).toBe(true);
      expect(parts.some((p) => p.startsWith("filename*="))).toBe(true);
    });

    it("does not end with a trailing semicolon", () => {
      const result = buildContentDisposition("Report", "slug");
      expect(result.trimEnd()).not.toMatch(/;$/);
    });
  });
});
