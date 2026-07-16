/**
 * Unit tests for the legal benchmark recursion API routes (deprecated).
 * All endpoints return 410 Gone since legal_benchmark_recursions table was dropped.
 */

import { describe, test, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/recursion/route";
import {
  GET as GET_ID,
  DELETE,
} from "@/app/api/workspaces/[slug]/legal/benchmarks/recursion/[id]/route";

describe("Legal Benchmark Recursion Routes (deprecated)", () => {
  const makeRequest = (method = "GET") =>
    new NextRequest("http://localhost/api/workspaces/openlaw/legal/benchmarks/recursion", {
      method,
    });

  test("POST returns 410", async () => {
    const res = await POST(makeRequest("POST"));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("Feature deprecated");
  });

  test("GET returns 410", async () => {
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("Feature deprecated");
  });

  test("GET /[id] returns 410", async () => {
    const res = await GET_ID(makeRequest("GET"));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("Feature deprecated");
  });

  test("DELETE /[id] returns 410", async () => {
    const res = await DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("Feature deprecated");
  });
});
