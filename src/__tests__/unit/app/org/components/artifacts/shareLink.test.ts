import { describe, it, expect } from "vitest";
import { artifactShareUrl } from "@/app/org/[githubLogin]/_components/artifacts/shareLink";

describe("artifactShareUrl", () => {
  it("keeps the page, view and chat, and adds an encoded artifact param", () => {
    const url = new URL(artifactShareUrl("https://hive.test/org/acme?view=canvas&chat=c1#x", "pr:a/b#1"));
    expect(url.pathname).toBe("/org/acme");
    expect(url.searchParams.get("chat")).toBe("c1");
    expect(url.searchParams.get("view")).toBe("canvas");
    expect(url.searchParams.get("artifact")).toBe("pr:a/b#1");
    expect(url.hash).toBe("");
  });
  it("replaces an existing artifact param", () => {
    const url = new URL(artifactShareUrl("https://hive.test/org/acme?artifact=old", "id:new"));
    expect(url.searchParams.getAll("artifact")).toEqual(["id:new"]);
  });
});
