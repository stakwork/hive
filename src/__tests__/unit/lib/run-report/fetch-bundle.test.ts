import { describe, it, expect } from "vitest";
import { isPrivateAddress, BundleFetchError, MAX_BUNDLE_BYTES } from "@/lib/run-report/fetch-bundle";

describe("isPrivateAddress", () => {
  it("allows public IPv4", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "52.216.1.1", "172.32.0.1"]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  it("rejects loopback, RFC1918, link-local and CGNAT", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata service
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it("handles the 172.16/12 boundary precisely", () => {
    expect(isPrivateAddress("172.15.255.255")).toBe(false);
    expect(isPrivateAddress("172.16.0.0")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("172.32.0.0")).toBe(false);
  });

  it("rejects IPv6 loopback, link-local and unique-local", () => {
    for (const address of ["::1", "::", "fe80::1", "fc00::1", "fd00::1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });

  it("unwraps IPv4-mapped IPv6 rather than treating it as public", () => {
    // ::ffff:127.0.0.1 is loopback wearing an IPv6 costume.
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("refuses anything that is not an IP literal", () => {
    // Fail closed: never guess.
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("BundleFetchError", () => {
  it("carries a reason code and never a URL", () => {
    const error = new BundleFetchError("dns_private_address");
    expect(error.reason).toBe("dns_private_address");
    expect(error.message).not.toContain("http");
    expect(error.message).not.toContain("amazonaws");
  });
});

describe("byte cap", () => {
  it("is bounded and finite", () => {
    expect(MAX_BUNDLE_BYTES).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_BUNDLE_BYTES)).toBe(true);
  });
});
