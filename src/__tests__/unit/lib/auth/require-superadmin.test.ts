import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import { db } from "@/lib/db";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

describe("requireSuperAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when USER_ID header is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");

    const result = await requireSuperAdmin(request);

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(401);
      const body = await result.json();
      expect(body).toEqual({ error: "Unauthorized" });
    }
  });

  it("should return 403 when user is not found in database", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-123");

    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const result = await requireSuperAdmin(request);

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(403);
      const body = await result.json();
      expect(body).toEqual({ error: "Forbidden" });
    }
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-123" },
      select: { role: true },
    });
  });

  it("should return 403 when user role is USER", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-123");

    vi.mocked(db.user.findUnique).mockResolvedValue({ role: "USER" } as any);

    const result = await requireSuperAdmin(request);

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(403);
      const body = await result.json();
      expect(body).toEqual({ error: "Forbidden" });
    }
  });

  it("should return 403 when user role is ADMIN", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-123");

    vi.mocked(db.user.findUnique).mockResolvedValue({ role: "ADMIN" } as any);

    const result = await requireSuperAdmin(request);

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(403);
      const body = await result.json();
      expect(body).toEqual({ error: "Forbidden" });
    }
  });

  it("should return 403 when user role is MODERATOR", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-123");

    vi.mocked(db.user.findUnique).mockResolvedValue({ role: "MODERATOR" } as any);

    const result = await requireSuperAdmin(request);

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(403);
      const body = await result.json();
      expect(body).toEqual({ error: "Forbidden" });
    }
  });

  it("should return userId when user role is SUPER_ADMIN", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-123");

    vi.mocked(db.user.findUnique).mockResolvedValue({ role: "SUPER_ADMIN" } as any);

    const result = await requireSuperAdmin(request);

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toEqual({ userId: "user-123" });
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-123" },
      select: { role: true },
    });
  });

  it("should handle different user IDs correctly", async () => {
    const userId = "clx9z8y7x6w5v4u3t2s1";
    const request = new NextRequest("http://localhost:3000/api/admin/users");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, userId);

    vi.mocked(db.user.findUnique).mockResolvedValue({ role: "SUPER_ADMIN" } as any);

    const result = await requireSuperAdmin(request);

    expect(result).toEqual({ userId });
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: userId },
      select: { role: true },
    });
  });
});
