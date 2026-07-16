/**
 * Unit tests for `GET /api/cron/legal-recursion` (deprecated).
 * The route returns 410 Gone for all requests.
 */

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/legal-recursion/route";

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/legal-recursion", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("GET /api/cron/legal-recursion (deprecated)", () => {
  it("returns 410 with no auth header", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.message).toBe("Deprecated");
  });

  it("returns 410 with valid auth header", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.message).toBe("Deprecated");
  });

  it("returns 410 with wrong auth header", async () => {
    const res = await GET(makeRequest("Bearer wrong"));
    expect(res.status).toBe(410);
  });
});
