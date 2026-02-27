import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/user/profile/route";
import { getServerSession } from "next-auth";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { db } from "@/lib/db";

describe("PATCH /api/user/profile", () => {
  const mockSession = {
    user: { id: "test-user-id", email: "test@example.com" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 401 when unauthenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: "testalias" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  test("updates sphinxAlias successfully", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "test-user-id",
      sphinxAlias: "testalias",
    } as any);

    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: "testalias" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sphinxAlias).toBe("testalias");
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: { sphinxAlias: "testalias" },
      select: { sphinxAlias: true },
    });
  });

  test("trims whitespace from sphinxAlias", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "test-user-id",
      sphinxAlias: "testalias",
    } as any);

    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: "  testalias  " }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: { sphinxAlias: "testalias" },
      select: { sphinxAlias: true },
    });
  });

  test("converts empty string to null", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "test-user-id",
      sphinxAlias: null,
    } as any);

    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: "" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sphinxAlias).toBeNull();
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: { sphinxAlias: null },
      select: { sphinxAlias: true },
    });
  });

  test("accepts null sphinxAlias", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(db.user.update).mockResolvedValue({
      id: "test-user-id",
      sphinxAlias: null,
    } as any);

    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: null }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sphinxAlias).toBeNull();
  });

  test("returns 400 for non-string sphinxAlias", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);

    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: 123 }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("sphinxAlias must be a string");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  test("returns 400 for sphinxAlias exceeding 50 characters", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);

    const longAlias = "a".repeat(51);
    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: longAlias }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("sphinxAlias must be 50 characters or less");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  test("returns 500 on database error", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(db.user.update).mockRejectedValue(new Error("DB error"));

    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: "testalias" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to update profile");
  });
});
