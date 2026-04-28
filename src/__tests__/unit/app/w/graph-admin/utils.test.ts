import { describe, it, expect } from "vitest";
import { extractPubkey } from "@/app/w/[slug]/graph-admin/utils";

describe("extractPubkey", () => {
  it("strips routeHint and channelId suffix from full string", () => {
    expect(extractPubkey("03324c8cabc_034bcc1122_529771090553929734")).toBe("03324c8cabc");
  });

  it("returns bare pubkey unchanged when no underscore present", () => {
    expect(extractPubkey("02abc123def456")).toBe("02abc123def456");
  });

  it("trims leading and trailing whitespace", () => {
    expect(extractPubkey("  03abc456  ")).toBe("03abc456");
  });

  it("trims whitespace from pubkey when routeHint suffix is present", () => {
    expect(extractPubkey("  03abc456_routeHint  ")).toBe("03abc456");
  });
});
