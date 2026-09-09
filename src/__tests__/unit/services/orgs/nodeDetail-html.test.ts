/**
 * Cross-org guard for `loadNodeDetail("html", …)`.
 *
 * `html:<cuid>` live ids travel through `?canvas=` URLs and Pusher
 * payloads, so a bare `findUnique({ where: { id } })` would leak
 * another org's title/slug. The dispatcher must query with `{ id, orgId }`
 * and return null (404 upstream) on a miss — indistinguishable from
 * a genuinely missing page.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    htmlPage: { findFirst: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { loadNodeDetail } from "@/services/orgs/nodeDetail";

const findFirst = db.htmlPage.findFirst as unknown as ReturnType<typeof vi.fn>;

const PAGE = {
  id: "page-1",
  slug: "hive-vs-workspaces",
  title: "Hive vs Workspaces",
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-06-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadNodeDetail html", () => {
  it("returns slug in extras and never shareRef/s3Key when the row is in this org", async () => {
    findFirst.mockResolvedValue(PAGE);

    const detail = await loadNodeDetail("html", PAGE.id, "org-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: PAGE.id, orgId: "org-1" },
      select: {
        id: true,
        slug: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(detail).toMatchObject({
      kind: "html",
      id: PAGE.id,
      name: PAGE.title,
      extras: { slug: PAGE.slug },
    });
    expect(detail?.extras).not.toHaveProperty("shareRef");
    expect(detail?.extras).not.toHaveProperty("s3Key");
  });

  it("returns null on a cross-org (or missing) lookup", async () => {
    findFirst.mockResolvedValue(null);

    const detail = await loadNodeDetail("html", PAGE.id, "other-org");

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAGE.id, orgId: "other-org" },
      }),
    );
    expect(detail).toBeNull();
  });
});
