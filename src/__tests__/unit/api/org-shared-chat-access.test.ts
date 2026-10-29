import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { dbMock, sessionMock, belongsMock, workspaceAccessMock } = vi.hoisted(() => ({
  dbMock: {
    sourceControlOrg: { findFirst: vi.fn() },
    sourceControlToken: { findFirst: vi.fn() },
    sharedConversation: { findUnique: vi.fn(), create: vi.fn() },
  },
  sessionMock: vi.fn(),
  belongsMock: vi.fn(),
  workspaceAccessMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("next-auth/next", () => ({ getServerSession: sessionMock }));
vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));
vi.mock("@/lib/auth/api-token", () => ({ validateApiToken: vi.fn(() => false) }));
vi.mock("@/services/workspace", () => ({
  validateUserBelongsToOrg: belongsMock,
  validateWorkspaceAccess: workspaceAccessMock,
}));

import { GET } from "@/app/api/org/[githubLogin]/chat/shared/[shareId]/route";
import { POST } from "@/app/api/org/[githubLogin]/chat/share/route";

const params = { params: Promise.resolve({ githubLogin: "acme", shareId: "s1" }) };

describe("org shared-chat routes require workspace membership in the org", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionMock.mockResolvedValue({ user: { id: "u1" } });
    dbMock.sourceControlOrg.findFirst.mockResolvedValue({ id: "org1", githubLogin: "acme" });
  });

  test("GET refuses a user with only a GitHub SourceControlToken (no workspace membership)", async () => {
    dbMock.sourceControlToken.findFirst.mockResolvedValue({ id: "tok" }); // must not matter
    belongsMock.mockResolvedValue(false);
    const res = await GET(new NextRequest("http://x/api/org/acme/chat/shared/s1"), params);
    expect(res.status).toBe(403);
    expect(belongsMock).toHaveBeenCalledWith("acme", "u1");
    expect(dbMock.sharedConversation.findUnique).not.toHaveBeenCalled();
  });

  test("GET lets a member of a workspace in the org read the share", async () => {
    belongsMock.mockResolvedValue(true);
    dbMock.sharedConversation.findUnique.mockResolvedValue({
      id: "s1",
      sourceControlOrgId: "org1",
      title: "t",
      messages: [],
    });
    const res = await GET(new NextRequest("http://x/api/org/acme/chat/shared/s1"), params);
    expect(res.status).toBe(200);
  });

  test("POST refuses a non-member", async () => {
    dbMock.sourceControlToken.findFirst.mockResolvedValue({ id: "tok" });
    belongsMock.mockResolvedValue(false);
    const req = new Request("http://x/api/org/acme/chat/share", {
      method: "POST",
      body: JSON.stringify({ messages: [], followUpQuestions: [] }),
    });
    const res = await POST(req, params);
    expect(res.status).toBe(403);
    expect(dbMock.sharedConversation.create).not.toHaveBeenCalled();
  });
});
