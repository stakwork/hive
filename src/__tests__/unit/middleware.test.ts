import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const getTokenMock = vi.fn();
const dbUserFindUniqueMock = vi.fn();

vi.mock("next-auth/jwt", () => ({
  getToken: getTokenMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: dbUserFindUniqueMock,
    },
  },
}));

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? "test-secret";

const { middleware } = await import("@/middleware");

function createRequest(pathname: string, headers?: HeadersInit) {
  return new NextRequest(`http://localhost${pathname}`, {
    headers,
  });
}

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows public routes without calling getToken", async () => {
    const response = await middleware(createRequest("/"));

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("public");
    expect(response.headers.get(MIDDLEWARE_HEADERS.REQUEST_ID)).toBeTruthy();
  });

  it("allows webhook routes and marks them as webhook", async () => {
    const response = await middleware(createRequest("/api/github/webhook"));

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("webhook");
  });

  it("allows system routes (cron) and marks them as system", async () => {
    const response = await middleware(createRequest("/api/cron/task-coordinator"));

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("system");
  });

  it("returns 401 JSON for protected API routes without a token", async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await middleware(createRequest("/api/secure"));

    expect(getTokenMock).toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("unauthorized");
    const body = await response.clone().json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("redirects protected pages to the root when unauthenticated", async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await middleware(createRequest("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("unauthenticated");
  });

  it("attaches user headers when authenticated", async () => {
    getTokenMock.mockResolvedValueOnce({
      id: "user-123",
      email: "user@example.com",
      name: "Test User",
    });

    const response = await middleware(createRequest("/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("authenticated");
    expect(response.headers.get(MIDDLEWARE_HEADERS.USER_ID)).toBeNull();
  });

  it("sanitizes incoming middleware headers", async () => {
    const response = await middleware(
      createRequest("/", {
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "spoofed",
        [MIDDLEWARE_HEADERS.USER_ID]: "spoofed",
      })
    );

    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("public");
    expect(response.headers.get(MIDDLEWARE_HEADERS.USER_ID)).toBeNull();
  });

  describe("superadmin routes", () => {
    it("redirects /admin page to / when user is not ADMIN", async () => {
      getTokenMock.mockResolvedValueOnce({
        id: "user-123",
        email: "user@example.com",
        name: "Test User",
      });

      dbUserFindUniqueMock.mockResolvedValueOnce({
        role: "USER",
      });

      const response = await middleware(createRequest("/admin"));

      expect(dbUserFindUniqueMock).toHaveBeenCalledWith({
        where: { id: "user-123" },
        select: { role: true },
      });
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost/");
      expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("forbidden");
    });

    it("allows /admin page when user is ADMIN", async () => {
      getTokenMock.mockResolvedValueOnce({
        id: "admin-123",
        email: "admin@example.com",
        name: "Admin User",
      });

      dbUserFindUniqueMock.mockResolvedValueOnce({
        role: "ADMIN",
      });

      const response = await middleware(createRequest("/admin"));

      expect(dbUserFindUniqueMock).toHaveBeenCalledWith({
        where: { id: "admin-123" },
        select: { role: true },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("authenticated");
      expect(response.headers.get(MIDDLEWARE_HEADERS.USER_ROLE)).toBe("ADMIN");
    });

    it("returns 403 JSON for /api/admin/* when user is not ADMIN", async () => {
      getTokenMock.mockResolvedValueOnce({
        id: "user-123",
        email: "user@example.com",
        name: "Test User",
      });

      dbUserFindUniqueMock.mockResolvedValueOnce({
        role: "USER",
      });

      const response = await middleware(createRequest("/api/admin/test"));

      expect(dbUserFindUniqueMock).toHaveBeenCalledWith({
        where: { id: "user-123" },
        select: { role: true },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("forbidden");
      const body = await response.clone().json();
      expect(body).toEqual({ error: "Forbidden" });
    });

    it("allows /api/admin/* when user is ADMIN", async () => {
      getTokenMock.mockResolvedValueOnce({
        id: "admin-123",
        email: "admin@example.com",
        name: "Admin User",
      });

      dbUserFindUniqueMock.mockResolvedValueOnce({
        role: "ADMIN",
      });

      const response = await middleware(createRequest("/api/admin/stats"));

      expect(dbUserFindUniqueMock).toHaveBeenCalledWith({
        where: { id: "admin-123" },
        select: { role: true },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("authenticated");
      expect(response.headers.get(MIDDLEWARE_HEADERS.USER_ROLE)).toBe("ADMIN");
    });

    it("returns 500 and redirects when DB query fails for admin page", async () => {
      getTokenMock.mockResolvedValueOnce({
        id: "user-123",
        email: "user@example.com",
        name: "Test User",
      });

      dbUserFindUniqueMock.mockRejectedValueOnce(new Error("Database error"));

      const response = await middleware(createRequest("/admin"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost/");
      expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("error");
    });

    it("returns 500 JSON when DB query fails for admin API route", async () => {
      getTokenMock.mockResolvedValueOnce({
        id: "user-123",
        email: "user@example.com",
        name: "Test User",
      });

      dbUserFindUniqueMock.mockRejectedValueOnce(new Error("Database error"));

      const response = await middleware(createRequest("/api/admin/test"));

      expect(response.status).toBe(500);
      expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("error");
      const body = await response.clone().json();
      expect(body).toEqual({ error: "Internal Server Error" });
    });
  });
});
