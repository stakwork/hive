import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";

describe("requireSuperAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when no user ID in headers", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    
    const result = await requireSuperAdmin(request);

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("Unauthorized");
    }
  });

  it("should return 403 when user role is not ADMIN", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-123");

    vi.mocked(db.user.findUnique).mockResolvedValue({
      role: "USER",
    } as any);

    const result = await requireSuperAdmin(request);

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(403);
      const data = await result.json();
      expect(data.error).toBe("Forbidden");
    }

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-123" },
      select: { role: true },
    });
  });

  it("should return 403 when user is not found", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-123");

    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const result = await requireSuperAdmin(request);

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(403);
      const data = await result.json();
      expect(data.error).toBe("Forbidden");
    }
  });

  it("should return userId when user role is ADMIN", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, "admin-123");

    vi.mocked(db.user.findUnique).mockResolvedValue({
      role: "ADMIN",
    } as any);

    const result = await requireSuperAdmin(request);

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toEqual({ userId: "admin-123" });

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "admin-123" },
      select: { role: true },
    });
  });

  it("should return 500 when database query fails", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/test");
    request.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-123");

    vi.mocked(db.user.findUnique).mockRejectedValue(new Error("Database error"));

    const result = await requireSuperAdmin(request);

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(500);
      const data = await result.json();
      expect(data.error).toBe("Internal Server Error");
    }
  });
});
