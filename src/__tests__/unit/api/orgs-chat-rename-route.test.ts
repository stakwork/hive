import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const updateMany = vi.fn();
const findUnique = vi.fn();
const validate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { sourceControlOrg: { findUnique: (...a: unknown[]) => findUnique(...a) }, sharedConversation: { updateMany: (...a: unknown[]) => updateMany(...a) } },
}));
vi.mock("@/services/workspace", () => ({ validateUserBelongsToOrg: (...a: unknown[]) => validate(...a) }));
vi.mock("@/lib/middleware/utils", async () => {
  const { NextResponse } = await import("next/server");
  return {
    getMiddlewareContext: () => ({}),
    requireAuth: () => ({ id: "u1" }),
    __r: NextResponse,
  };
});

import { POST } from "@/app/api/orgs/[githubLogin]/chat/conversations/[conversationId]/rename/route";

const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ githubLogin: "acme", conversationId: "c1" }) },
  );

describe("POST rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validate.mockResolvedValue(true);
    findUnique.mockResolvedValue({ id: "org1" });
    updateMany.mockResolvedValue({ count: 1 });
  });

  it("trims and saves the title, scoped to the owner's org-canvas row", async () => {
    const res = await call({ title: "  Hello  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "c1", sourceControlOrgId: "org1", userId: "u1", source: "org-canvas" },
      data: { title: "Hello" },
    });
  });

  it.each([{}, { title: 5 }, { title: "   " }, { title: "x".repeat(201) }])("rejects %j with 400", async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("404s when no row matches or user is not in the org", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect((await call({ title: "a" })).status).toBe(404);
    validate.mockResolvedValue(false);
    expect((await call({ title: "a" })).status).toBe(404);
  });
});
