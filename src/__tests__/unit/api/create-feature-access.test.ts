import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { accessMock, extractMock } = vi.hoisted(() => ({ accessMock: vi.fn(), extractMock: vi.fn() }));

vi.mock("@/services/workspace", () => ({ validateWorkspaceAccess: accessMock }));
vi.mock("@/lib/ai/extract-feature", () => ({ extractFeatureFromTranscript: extractMock }));
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({})),
  requireAuth: vi.fn(() => ({ id: "u1" })),
}));

import { POST } from "@/app/api/features/create-feature/route";

const req = () =>
  new NextRequest("http://x/api/features/create-feature", {
    method: "POST",
    body: JSON.stringify({ workspaceSlug: "acme", transcript: "build a thing" }),
  });

describe("POST /api/features/create-feature workspace access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    extractMock.mockResolvedValue({ title: "T", brief: "B" });
  });

  test("refuses a non-member without running extraction", async () => {
    accessMock.mockResolvedValue({ hasAccess: false, canRead: false, canWrite: false, canAdmin: false });
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(extractMock).not.toHaveBeenCalled();
  });

  test("allows a member with write access", async () => {
    accessMock.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: true, canAdmin: false });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(extractMock).toHaveBeenCalled();
  });
});
