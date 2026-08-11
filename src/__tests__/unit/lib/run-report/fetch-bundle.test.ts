import { describe, it, expect } from "vitest";
import { BundleFetchError, MAX_BUNDLE_BYTES } from "@/lib/run-report/fetch-bundle";

describe("BundleFetchError", () => {
  it("carries a reason code and never a URL", () => {
    const error = new BundleFetchError("redirect_escaped_allowlist");
    expect(error.reason).toBe("redirect_escaped_allowlist");
    expect(error.message).not.toContain("http");
    expect(error.message).not.toContain("amazonaws");
  });

  it("is distinguishable from a generic Error", () => {
    expect(new BundleFetchError("timeout")).toBeInstanceOf(BundleFetchError);
    expect(new BundleFetchError("timeout").name).toBe("BundleFetchError");
  });
});

describe("byte cap", () => {
  it("is bounded and finite", () => {
    expect(MAX_BUNDLE_BYTES).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_BUNDLE_BYTES)).toBe(true);
  });
});
