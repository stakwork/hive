import { describe, test, expect } from "vitest";
import { computeFingerprint } from "@/lib/utils/error-fingerprint";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STACK_TRACE_A = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "    at resolveUser (/app/src/lib/auth.ts:42:20)",
  "    at async POST (/app/src/app/api/users/route.ts:18:14)",
  "    at async nextHandler (/app/node_modules/next/dist/server/next-server.js:1200:30)",
  "    at async DevServer.runApi (/app/node_modules/next/dist/server/dev/next-dev-server.js:555:9)",
  "    at async processTicksAndRejections (node:internal/process/task_queues:95:5)",
].join("\n");

// Same logical code, different build — paths and line numbers differ
const STACK_TRACE_A_DIFFERENT_BUILD = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "    at resolveUser (/build/output/src/lib/auth.js:88:42)",
  "    at async POST (/build/output/src/app/api/users/route.js:34:6)",
  "    at async nextHandler (/build/output/node_modules/next/dist/server/next-server.js:9999:1)",
  "    at async DevServer.runApi (/build/output/node_modules/next/dist/server/dev/next-dev-server.js:200:3)",
  "    at async processTicksAndRejections (node:internal/process/task_queues:100:9)",
].join("\n");

const STACK_TRACE_B = [
  "ReferenceError: fetch is not defined",
  "    at fetchExternalData (/app/src/services/external.ts:15:10)",
  "    at async getPageProps (/app/src/app/page.tsx:30:5)",
].join("\n");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeFingerprint", () => {
  describe("client override", () => {
    test("uses clientFingerprint verbatim when provided", () => {
      const result = computeFingerprint({
        exceptionType: "TypeError",
        stackTrace: STACK_TRACE_A,
        clientFingerprint: "my-custom-group-key",
      });
      expect(result).toBe("my-custom-group-key");
    });

    test("trims whitespace from clientFingerprint", () => {
      const result = computeFingerprint({
        exceptionType: "TypeError",
        clientFingerprint: "  padded-key  ",
      });
      expect(result).toBe("padded-key");
    });

    test("ignores empty string clientFingerprint and falls through to default", () => {
      const withEmpty = computeFingerprint({
        exceptionType: "TypeError",
        stackTrace: STACK_TRACE_A,
        clientFingerprint: "",
      });
      const withUndefined = computeFingerprint({
        exceptionType: "TypeError",
        stackTrace: STACK_TRACE_A,
      });
      expect(withEmpty).toBe(withUndefined);
    });

    test("ignores whitespace-only clientFingerprint and falls through to default", () => {
      const withWhitespace = computeFingerprint({
        exceptionType: "TypeError",
        stackTrace: STACK_TRACE_A,
        clientFingerprint: "   ",
      });
      const withUndefined = computeFingerprint({
        exceptionType: "TypeError",
        stackTrace: STACK_TRACE_A,
      });
      expect(withWhitespace).toBe(withUndefined);
    });
  });

  describe("default fingerprint computation", () => {
    test("returns a hex string (SHA-256 output)", () => {
      const result = computeFingerprint({
        exceptionType: "TypeError",
        stackTrace: STACK_TRACE_A,
      });
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    test("is stable — same input produces same fingerprint", () => {
      const first = computeFingerprint({ exceptionType: "TypeError", stackTrace: STACK_TRACE_A });
      const second = computeFingerprint({ exceptionType: "TypeError", stackTrace: STACK_TRACE_A });
      expect(first).toBe(second);
    });

    test("normalises paths and line numbers — same logical stack from different builds produces same fingerprint", () => {
      const fromOriginal = computeFingerprint({
        exceptionType: "TypeError",
        stackTrace: STACK_TRACE_A,
      });
      const fromBuild = computeFingerprint({
        exceptionType: "TypeError",
        stackTrace: STACK_TRACE_A_DIFFERENT_BUILD,
      });
      expect(fromOriginal).toBe(fromBuild);
    });

    test("produces different fingerprints for different exception types", () => {
      const typeError = computeFingerprint({ exceptionType: "TypeError", stackTrace: STACK_TRACE_A });
      const refError = computeFingerprint({ exceptionType: "ReferenceError", stackTrace: STACK_TRACE_A });
      expect(typeError).not.toBe(refError);
    });

    test("produces different fingerprints for different stack traces", () => {
      const traceA = computeFingerprint({ exceptionType: "TypeError", stackTrace: STACK_TRACE_A });
      const traceB = computeFingerprint({ exceptionType: "TypeError", stackTrace: STACK_TRACE_B });
      expect(traceA).not.toBe(traceB);
    });

    test("works without a stack trace (returns a valid hash)", () => {
      const result = computeFingerprint({ exceptionType: "UnknownError" });
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    test("without a stack trace, fingerprint differs only by exceptionType", () => {
      const a = computeFingerprint({ exceptionType: "ErrorA" });
      const b = computeFingerprint({ exceptionType: "ErrorB" });
      expect(a).not.toBe(b);
    });

    test("client override produces different fingerprint than the computed default", () => {
      const computed = computeFingerprint({ exceptionType: "TypeError", stackTrace: STACK_TRACE_A });
      const override = computeFingerprint({
        exceptionType: "TypeError",
        stackTrace: STACK_TRACE_A,
        clientFingerprint: "my-custom-key",
      });
      expect(computed).not.toBe(override);
      expect(override).toBe("my-custom-key");
    });
  });
});
