import { POST } from "@/app/api/auth/revoke-github/route";
import { db as prisma } from "@/lib/db";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth/next";

vi.mock("next-auth/next");

describe("API revoke GitHub auth", () => {
  const mockGetServerSession = vi.mocked(getServerSession);

  it("returns 401 if user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized",
    });
  });

  it("returns 500 if session user has no id", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: {},
      expires: new Date().toISOString(),
    });

    const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Invalid user id",
    });
  });

  it("returns 404 if user has no account", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: {
        id: "1",
      },
      expires: new Date().toISOString(),
    });
    vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce(null);

    const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "User not found",
    });
  });

  it("returns 200 and revokes GitHub auth", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: {
        id: "1",
      },
      expires: new Date().toISOString(),
    });
    vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce({
      id: "1",
      name: "Test User",
      email: "test@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      username: "testuser",
      bio: null,
      location: null,
      website: null,
      github: null,
      twitter: null,
      telegram: null,
      nostr: null,
    });
    vi.spyOn(prisma.account, "deleteMany").mockResolvedValueOnce({ count: 1 });

    const request = new NextRequest("http://localhost:3000/api/auth/revoke-github", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
    });
    expect(prisma.account.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "1",
        provider: "github",
      },
    });
  });
});