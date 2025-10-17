import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const getTokenMock = vi.fn();

vi.mock("next-auth/jwt", () => ({
  getToken: getTokenMock,
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
  expect(body).toEqual({ kind: "unauthorized", statusCode: 401, message: "Unauthorized" });
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

  it("returns 401 for protected API route with malformed token", async () => {
    getTokenMock.mockResolvedValueOnce({}); // missing id/email/name
    const response = await middleware(createRequest("/api/secure"));
    expect(response.status).toBe(401);
    const body = await response.clone().json();
    expect(body.kind).toBe("unauthorized");
    expect(body.statusCode).toBe(401);
    expect(body.message).toBe("Unauthorized");
  });

  it("handles missing NEXTAUTH_SECRET env variable", async () => {
    const oldSecret = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    let errorCaught = false;
    try {
      await middleware(createRequest("/api/secure"));
    } catch (err) {
      errorCaught = true;
      expect((err as Error).message).toMatch(/NEXTAUTH_SECRET/);
    }
    process.env.NEXTAUTH_SECRET = oldSecret;
    expect(errorCaught).toBe(true);
  });

  it("handles landing page logic for protected route", async () => {
    // Simulate landing page enabled and no valid cookie/token
    const landingCookieName = "landing_cookie";
    const landingCookieValue = "invalid";
    const request = createRequest("/dashboard", {
      cookie: `${landingCookieName}=${landingCookieValue}`,
    });
    // Simulate getToken returns null
    getTokenMock.mockResolvedValueOnce(null);
    // Patch isLandingPageEnabled to return true
    vi.spyOn(await import("@/lib/auth/landing-cookie"), "isLandingPageEnabled").mockReturnValue(true);
    const response = await middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("landing_required");
  });

  it("returns 500 for unexpected errors in middleware", async () => {
    // Simulate error thrown in getToken
    getTokenMock.mockImplementationOnce(() => {
      throw new Error("Unexpected error");
    });
    const response = await middleware(createRequest("/api/secure"));
    expect(response.status).toBe(500);
    const body = await response.clone().json();
    expect(body.kind).toBe("server_error");
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe("Internal Server Error");
  });
});
