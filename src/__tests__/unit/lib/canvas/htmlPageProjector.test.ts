/**
 * Unit tests for htmlPageProjector — HtmlPage rows as root-canvas cards.
 *
 * Covers:
 *   - root-scope org filtering (an org only sees its own pages)
 *   - HTML_LIMIT cap (take: 25)
 *   - non-root scopes emit nothing and do not query
 *   - customData is slug + title only (never s3Key / shareRef)
 *   - htmlPageProjector is registered in PROJECTORS
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    htmlPage: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { htmlPageProjector, PROJECTORS } from "@/lib/canvas/projectors";

const dbMock = db as unknown as {
  htmlPage: { findMany: ReturnType<typeof vi.fn> };
};

const ORG_ID = "org-1";

beforeEach(() => {
  vi.resetAllMocks();
  dbMock.htmlPage.findMany.mockResolvedValue([]);
});

describe("htmlPageProjector", () => {
  it("is registered in PROJECTORS", () => {
    expect(PROJECTORS).toContain(htmlPageProjector);
  });

  it("returns no nodes and does not query on a non-root scope", async () => {
    const result = await htmlPageProjector.project(
      { kind: "initiative", initiativeId: "init-1" },
      ORG_ID,
    );
    expect(result).toEqual({ nodes: [] });
    expect(dbMock.htmlPage.findMany).not.toHaveBeenCalled();
  });

  it("queries only this org, newest first, capped at 25", async () => {
    await htmlPageProjector.project({ kind: "root" }, ORG_ID);
    expect(dbMock.htmlPage.findMany).toHaveBeenCalledTimes(1);
    const args = dbMock.htmlPage.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ orgId: ORG_ID });
    expect(args.orderBy).toEqual({ updatedAt: "desc" });
    expect(args.take).toBe(25);
    expect(args.select).toEqual({ id: true, slug: true, title: true });
    expect(args.select).not.toHaveProperty("s3Key");
    expect(args.select).not.toHaveProperty("shareRef");
  });

  it("emits html:<id> nodes with slug + title only in customData", async () => {
    dbMock.htmlPage.findMany.mockResolvedValue([
      { id: "p1", slug: "hive-vs-workspaces", title: "Hive vs Workspaces" },
      { id: "p2", slug: "q4-roadmap", title: "Q4 Roadmap" },
    ]);

    const { nodes } = await htmlPageProjector.project({ kind: "root" }, ORG_ID);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      id: "html:p1",
      category: "html",
      text: "Hive vs Workspaces",
      customData: { slug: "hive-vs-workspaces", title: "Hive vs Workspaces" },
    });
    expect(nodes[0].customData).not.toHaveProperty("s3Key");
    expect(nodes[0].customData).not.toHaveProperty("shareRef");
    expect(nodes[1].id).toBe("html:p2");
  });

  it("does not leak another org's pages — the where clause is orgId", async () => {
    // The projector never accepts an org id from the node; the only
    // filter is the `orgId` argument. A row belonging to org-2 would
    // only appear if the caller passed org-2.
    dbMock.htmlPage.findMany.mockResolvedValue([
      { id: "foreign", slug: "other-org-page", title: "Nope" },
    ]);
    await htmlPageProjector.project({ kind: "root" }, "org-1");
    expect(dbMock.htmlPage.findMany.mock.calls[0][0].where.orgId).toBe("org-1");
  });
});
