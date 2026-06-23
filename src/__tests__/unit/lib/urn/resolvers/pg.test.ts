// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    sourceControlOrg: { findUnique: vi.fn() },
  },
}));

vi.mock("@/services/orgs/nodeDetail", () => ({
  loadNodeDetail: vi.fn(),
}));

import { db } from "@/lib/db";
import { loadNodeDetail } from "@/services/orgs/nodeDetail";
import { resolvePgNode } from "@/lib/urn/resolvers/pg";

const mockFindUnique = db.sourceControlOrg.findUnique as ReturnType<typeof vi.fn>;
const mockLoadNodeDetail = loadNodeDetail as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePgNode", () => {
  it("returns null for a non-pg URN", async () => {
    const result = await resolvePgNode("urn:myorg:canvas:note:ws~abc.node1");
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns null for an invalid URN", async () => {
    const result = await resolvePgNode("not-a-urn");
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when org is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await resolvePgNode("urn:unknown-org:pg:initiative:abc");
    expect(result).toBeNull();
    expect(mockLoadNodeDetail).not.toHaveBeenCalled();
  });

  it("resolves org then calls loadNodeDetail with internal orgId", async () => {
    mockFindUnique.mockResolvedValue({ id: "org-internal-id" });
    const fakeDetail = { kind: "initiative", id: "abc", name: "Test", description: null };
    mockLoadNodeDetail.mockResolvedValue(fakeDetail);

    const result = await resolvePgNode("urn:myorg:pg:initiative:abc");

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { githubLogin: "myorg" },
      select: { id: true },
    });
    expect(mockLoadNodeDetail).toHaveBeenCalledWith("initiative", "abc", "org-internal-id");
    expect(result).toEqual(fakeDetail);
  });

  it("returns null when loadNodeDetail returns null (cross-org guard)", async () => {
    mockFindUnique.mockResolvedValue({ id: "org-internal-id" });
    mockLoadNodeDetail.mockResolvedValue(null);

    const result = await resolvePgNode("urn:myorg:pg:feature:xyz");
    expect(result).toBeNull();
  });

  it("passes the correct type and id from the URN to loadNodeDetail", async () => {
    mockFindUnique.mockResolvedValue({ id: "org-1" });
    mockLoadNodeDetail.mockResolvedValue({ kind: "milestone", id: "m-1", name: "M", description: null });

    await resolvePgNode("urn:acme:pg:milestone:m-1");

    expect(mockLoadNodeDetail).toHaveBeenCalledWith("milestone", "m-1", "org-1");
  });
});
