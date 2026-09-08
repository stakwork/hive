import { describe, it, expect } from "vitest";
import { swarmUrlFromTags } from "@/lib/swarm/swarm-url";

describe("swarmUrlFromTags", () => {
  it("returns https://<name>.sphinx.chat for a present UserAssignedName tag", () => {
    expect(
      swarmUrlFromTags([
        { key: "Swarm", value: "superadmin" },
        { key: "UserAssignedName", value: "my-swarm-node" },
      ]),
    ).toBe("https://my-swarm-node.sphinx.chat");
  });

  it("returns null when the UserAssignedName tag is missing", () => {
    expect(swarmUrlFromTags([{ key: "Swarm", value: "superadmin" }])).toBeNull();
  });

  it("returns null when the UserAssignedName tag is blank", () => {
    expect(swarmUrlFromTags([{ key: "UserAssignedName", value: "   " }])).toBeNull();
  });

  it("returns null for empty or missing tags", () => {
    expect(swarmUrlFromTags([])).toBeNull();
    expect(swarmUrlFromTags(undefined)).toBeNull();
    expect(swarmUrlFromTags(null)).toBeNull();
  });
});
