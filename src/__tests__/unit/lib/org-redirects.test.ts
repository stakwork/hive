import { describe, it, expect } from "vitest";
import { orgRedirectTarget } from "@/lib/helpers/org-redirects";

describe("orgRedirectTarget", () => {
  it.each([
    ["initiatives", "/org/acme?view=canvas&tab=initiatives"],
    ["schematic", "/org/acme?view=canvas"],
    ["workspaces", "/org/acme/settings?section=workspaces"],
    ["members", "/org/acme/settings?section=members"],
  ] as const)("%s -> %s", (page, expected) => {
    expect(orgRedirectTarget(page, "acme")).toBe(expected);
  });

  it("preserves other params", () => {
    expect(orgRedirectTarget("members", "acme", { foo: "1", x: ["a", "b"] })).toBe(
      "/org/acme/settings?foo=1&section=members",
    );
  });
});
