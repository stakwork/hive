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
    const response = await middleware(createRequest("/", { host: "localhost" }));

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("public");
    expect(response.headers.get(MIDDLEWARE_HEADERS.REQUEST_ID)).toBeTruthy();
  });

  it("allows webhook routes and marks them as webhook", async () => {
    const response = await middleware(createRequest("/api/github/webhook", { host: "localhost" }));

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("webhook");
  });

  it("allows system routes (cron) and marks them as system", async () => {
    const response = await middleware(createRequest("/api/cron/task-coordinator", { host: "localhost" }));

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("system");
  });

  it("returns 401 JSON for protected API routes without a token", async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await middleware(createRequest("/api/secure", { host: "localhost" }));

    expect(getTokenMock).toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("unauthorized");
    const body = await response.clone().json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("redirects protected pages to the root when unauthenticated", async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await middleware(createRequest("/dashboard", { host: "localhost" }));

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

    const response = await middleware(createRequest("/dashboard", { host: "localhost" }));

    expect(response.status).toBe(200);
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("authenticated");
    expect(response.headers.get(MIDDLEWARE_HEADERS.USER_ID)).toBeNull();
  });

  it("sanitizes incoming middleware headers", async () => {
    const response = await middleware(
      createRequest("/", {
        host: "localhost",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "spoofed",
        [MIDDLEWARE_HEADERS.USER_ID]: "spoofed",
      })
    );

    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("public");
    expect(response.headers.get(MIDDLEWARE_HEADERS.USER_ID)).toBeNull();
  });

  it("redirects HTTP to HTTPS for non-localhost requests", async () => {
    const response = await middleware(
      createRequest("/dashboard", {
        "x-forwarded-proto": "http",
        host: "example.com",
      })
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://localhost/dashboard");
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("https_redirect");
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
  });

  it("does not redirect HTTPS requests", async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await middleware(
      createRequest("/dashboard", {
        "x-forwarded-proto": "https",
        host: "example.com",
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("does not redirect HTTP requests on localhost", async () => {
    const response = await middleware(
      createRequest("/", {
        "x-forwarded-proto": "http",
        host: "localhost:3000",
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(MIDDLEWARE_HEADERS.AUTH_STATUS)).toBe("public");
  });

  it("includes security headers in all responses", async () => {
    const response = await middleware(createRequest("/", { host: "localhost" }));

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("includes HSTS header for non-localhost requests", async () => {
    const response = await middleware(
      createRequest("/", {
        "x-forwarded-proto": "https",
        host: "example.com",
      })
    );

    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
  });

  it("does not include HSTS header for localhost requests", async () => {
    const response = await middleware(
      createRequest("/", {
        host: "localhost:3000",
      })
    );

    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("includes security headers in API error responses", async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await middleware(
      createRequest("/api/secure", {
        "x-forwarded-proto": "https",
        host: "example.com",
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("includes security headers in redirect responses", async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await middleware(
      createRequest("/dashboard", {
        "x-forwarded-proto": "https",
        host: "example.com",
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
