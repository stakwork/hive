import { describe, test, expect } from "vitest";
import { graphParams, orgGraphHref } from "@/app/org/[githubLogin]/_components/graphHref";

describe("orgGraphHref", () => {
  test("links a node on the default tree without naming the type", () => {
    expect(orgGraphHref("stakwork", { workspace: "hive", type: "Concept", refId: "c-1" })).toBe(
      "/org/stakwork?view=graph&workspace=hive&ref_id=c-1",
    );
  });

  test("names any other type, so the link opens on that type's trees", () => {
    expect(orgGraphHref("stakwork", { workspace: "hive", type: "Datamodel", refId: "d-1" })).toBe(
      "/org/stakwork?view=graph&workspace=hive&type=Datamodel&ref_id=d-1",
    );
  });
});

describe("graphParams", () => {
  test("keeps the page's other params and drops what the location leaves out", () => {
    const here = new URLSearchParams("view=graph&chat=abc&workspace=old&type=Datamodel&ref_id=d-1");
    expect(graphParams({ workspace: "hive" }, here).toString()).toBe("view=graph&chat=abc&workspace=hive");
  });
});
