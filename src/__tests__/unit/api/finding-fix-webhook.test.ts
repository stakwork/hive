import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/system-map/finding-fix", () => ({ applyFindingFixCallback: vi.fn() }));

import { applyFindingFixCallback } from "@/services/system-map/finding-fix";
import { POST } from "@/app/api/system-map/finding-fix/webhook/route";

const TOKEN = "fix-token";
const req = (body: unknown, token: string | null = TOKEN) =>
  new NextRequest("http://localhost/api/system-map/finding-fix/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-api-token": token } : {}) },
    body: JSON.stringify(body),
  });

describe("POST /api/system-map/finding-fix/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_TOKEN = TOKEN;
  });

  it("rejects bad tokens", async () => {
    expect((await POST(req({ fixId: "a" }, "nope"))).status).toBe(401);
    expect((await POST(req({ fixId: "a" }, null))).status).toBe(401);
    expect(applyFindingFixCallback).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    expect((await POST(req({ status: "running" }))).status).toBe(400);
  });

  it("404s on unknown fix", async () => {
    vi.mocked(applyFindingFixCallback).mockResolvedValue(null);
    expect((await POST(req({ fixId: "a", status: "running" }))).status).toBe(404);
  });

  it("applies the callback", async () => {
    vi.mocked(applyFindingFixCallback).mockResolvedValue({
      id: "a",
      status: "PR_OPENED",
      prUrl: "https://github.com/a/b/pull/1",
    } as never);
    const res = await POST(req({ fixId: "a", status: "completed", prUrl: "https://github.com/a/b/pull/1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "PR_OPENED" });
    expect(applyFindingFixCallback).toHaveBeenCalledWith({
      fixId: "a",
      status: "completed",
      prUrl: "https://github.com/a/b/pull/1",
    });
  });
});
