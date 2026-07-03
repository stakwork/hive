import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));

const mockStakworkRunFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findFirst: (...args: unknown[]) => mockStakworkRunFindFirst(...args),
    },
  },
}));

import { GET } from "@/app/api/user/daily-recap/route";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/user/daily-recap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns { recap: null, generatedAt: null } when no completed run exists", async () => {
    mockStakworkRunFindFirst.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ recap: null, generatedAt: null });
  });

  it("returns recap text and generatedAt when a completed run exists", async () => {
    const createdAt = new Date("2026-01-15T09:00:00Z");
    mockStakworkRunFindFirst.mockResolvedValue({
      result: "You merged 2 PRs and created 3 tasks yesterday.",
      createdAt,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recap).toBe("You merged 2 PRs and created 3 tasks yesterday.");
    expect(body.generatedAt).toBe(createdAt.toISOString());
  });

  it("queries by the session userId — not a caller-supplied value", async () => {
    mockStakworkRunFindFirst.mockResolvedValue(null);

    await GET();

    expect(mockStakworkRunFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          type: StakworkRunType.DAILY_RECAP,
          status: WorkflowStatus.COMPLETED,
        }),
      }),
    );
  });

  it("orders by createdAt desc to return the most recent run", async () => {
    mockStakworkRunFindFirst.mockResolvedValue(null);
    await GET();

    expect(mockStakworkRunFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("filters result: { not: null } so recap_unchanged (null-result) runs are skipped", async () => {
    mockStakworkRunFindFirst.mockResolvedValue(null);
    await GET();

    expect(mockStakworkRunFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          result: { not: null },
        }),
      }),
    );
  });

  it("returns the last non-null result even when a newer null-result run exists", async () => {
    // Simulate: findFirst skips null-result run and returns the last real recap
    const createdAt = new Date("2026-01-15T08:00:00Z");
    mockStakworkRunFindFirst.mockResolvedValue({
      result: "My prior recap",
      createdAt,
    });

    const res = await GET();
    const body = await res.json();

    expect(body.recap).toBe("My prior recap");
    expect(body.generatedAt).toBe(createdAt.toISOString());
  });
});
