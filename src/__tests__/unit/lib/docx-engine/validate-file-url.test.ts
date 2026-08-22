/**
 * Unit tests for validateFileUrl (SSRF protection) exported from the proxy route.
 *
 * Covers:
 * - http: protocol rejection
 * - Non-https protocols (file:, ftp:, data:) rejection
 * - Unlisted hostname rejection
 * - Valid allowlisted https URL acceptance
 * - Empty / malformed URL rejection
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { validateFileUrl } from "@/lib/docx-proxy/validate-file-url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setAllowlist(...hosts: string[]) {
  process.env.DOCX_PROXY_ALLOWED_HOSTS = hosts.join(",");
}

function clearAllowlist() {
  delete process.env.DOCX_PROXY_ALLOWED_HOSTS;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateFileUrl — SSRF protection", () => {
  afterEach(() => {
    clearAllowlist();
  });

  // ── Protocol checks ────────────────────────────────────────────────────────

  describe("Protocol enforcement", () => {
    beforeEach(() => {
      setAllowlist("example.com", "files.example.com");
    });

    test("rejects http: protocol", () => {
      expect(() =>
        validateFileUrl("http://example.com/document.docx"),
      ).toThrow("Forbidden protocol");
    });

    test("rejects file: protocol", () => {
      expect(() =>
        validateFileUrl("file:///etc/passwd"),
      ).toThrow("Forbidden protocol");
    });

    test("rejects ftp: protocol", () => {
      expect(() =>
        validateFileUrl("ftp://example.com/document.docx"),
      ).toThrow("Forbidden protocol");
    });

    test("rejects data: URI (potential XSS vector)", () => {
      expect(() =>
        validateFileUrl("data:text/html,<script>alert(1)</script>"),
      ).toThrow();
    });

    test("accepts https: protocol on an allowlisted host", () => {
      const url = validateFileUrl("https://example.com/document.docx");
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("example.com");
    });
  });

  // ── Hostname allowlist ─────────────────────────────────────────────────────

  describe("Hostname allowlist", () => {
    test("rejects hostname not in allowlist", () => {
      setAllowlist("trusted.com");
      expect(() =>
        validateFileUrl("https://untrusted.com/doc.docx"),
      ).toThrow("Hostname not allowlisted");
    });

    test("rejects when allowlist is empty (no env var set)", () => {
      clearAllowlist(); // DOCX_PROXY_ALLOWED_HOSTS unset
      expect(() =>
        validateFileUrl("https://example.com/doc.docx"),
      ).toThrow("Hostname not allowlisted");
    });

    test("rejects when allowlist is empty string", () => {
      process.env.DOCX_PROXY_ALLOWED_HOSTS = "";
      expect(() =>
        validateFileUrl("https://example.com/doc.docx"),
      ).toThrow("Hostname not allowlisted");
    });

    test("accepts exactly matching hostname from allowlist", () => {
      setAllowlist("files.example.com");
      const url = validateFileUrl("https://files.example.com/contract.docx");
      expect(url.hostname).toBe("files.example.com");
    });

    test("accepts one of multiple allowlisted hostnames", () => {
      setAllowlist("files.example.com", "storage.acme.com", "docs.corp.io");
      const url = validateFileUrl("https://storage.acme.com/doc.docx");
      expect(url.hostname).toBe("storage.acme.com");
    });

    test("does NOT accept a hostname that is a substring of an allowlisted entry", () => {
      // 'evil.com' is not in the allowlist; 'evil.com.trusted.com' is not either.
      setAllowlist("trusted.com");
      expect(() =>
        validateFileUrl("https://evil.com.trusted.com/doc.docx"),
      ).toThrow("Hostname not allowlisted");
    });

    test("does NOT accept a hostname with allowlisted host as suffix", () => {
      // 'sub.trusted.com' should not pass when only 'trusted.com' is allowlisted
      setAllowlist("trusted.com");
      expect(() =>
        validateFileUrl("https://sub.trusted.com/doc.docx"),
      ).toThrow("Hostname not allowlisted");
    });

    test("trims whitespace in comma-separated allowlist entries", () => {
      // Env var may have spaces around commas
      process.env.DOCX_PROXY_ALLOWED_HOSTS = " files.example.com , storage.acme.com ";
      const url = validateFileUrl("https://files.example.com/doc.docx");
      expect(url.hostname).toBe("files.example.com");
    });
  });

  // ── Malformed / invalid URL inputs ────────────────────────────────────────

  describe("Invalid URL inputs", () => {
    beforeEach(() => {
      setAllowlist("example.com");
    });

    test("rejects completely malformed URL string", () => {
      expect(() => validateFileUrl("not-a-url")).toThrow("Invalid URL");
    });

    test("rejects empty string", () => {
      expect(() => validateFileUrl("")).toThrow("Invalid URL");
    });

    test("rejects URL with no protocol", () => {
      expect(() => validateFileUrl("//example.com/doc.docx")).toThrow();
    });
  });

  // ── Return value ──────────────────────────────────────────────────────────

  describe("Return value", () => {
    test("returns a URL object with correct pathname", () => {
      setAllowlist("files.example.com");
      const url = validateFileUrl(
        "https://files.example.com/contracts/v2/agreement.docx?token=abc",
      );
      expect(url).toBeInstanceOf(URL);
      expect(url.pathname).toBe("/contracts/v2/agreement.docx");
      expect(url.searchParams.get("token")).toBe("abc");
    });
  });
});
