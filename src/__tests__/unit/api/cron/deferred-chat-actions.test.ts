/**
 * Unit tests for `GET /api/cron/deferred-chat-actions`.
 *
 * Coverage:
 *   - Missing / wrong Authorization header → 401
 *   - DEFERRED_CHAT_ACTIONS_ENABLED not set → 200 Disabled
 *   - Successful dispatch → { fired: 1, failed: 0 }
 *   - Dispatcher error → 500
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the dispatcher before any route import.
vi.mock("@/services/deferred-chat-action-dispatcher", () => ({
  dispatchDueActions: vi.fn(),
}));

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/deferred-chat-actions", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("GET /api/cron/deferred-chat-actions — auth guard", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret";
    process.env.DEFERRED_CHAT_ACTIONS_ENABLED = "true";
    // Re-import after resetModules so env is picked up fresh.
    const mod = await import("@/app/api/cron/deferred-chat-actions/route");
    GET = mod.GET;
    // Re-apply the mock after resetModules.
    const { dispatchDueActions } = await import(
      "@/services/deferred-chat-action-dispatcher"
    );
    vi.mocked(dispatchDueActions).mockResolvedValue({
      fired: 0,
      failed: 0,
      errors: [],
    });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    delete process.env.DEFERRED_CHAT_ACTIONS_ENABLED;
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header has wrong secret", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 for a malformed Authorization header (no Bearer prefix)", async () => {
    const res = await GET(makeRequest("test-secret"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/deferred-chat-actions — feature flag disabled", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  const originalSecret = process.env.CRON_SECRET;
  const originalFlag = process.env.DEFERRED_CHAT_ACTIONS_ENABLED;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret";
    delete process.env.DEFERRED_CHAT_ACTIONS_ENABLED; // not set
    const mod = await import("@/app/api/cron/deferred-chat-actions/route");
    GET = mod.GET;
    const { dispatchDueActions } = await import(
      "@/services/deferred-chat-action-dispatcher"
    );
    vi.mocked(dispatchDueActions).mockResolvedValue({
      fired: 0,
      failed: 0,
      errors: [],
    });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    if (originalFlag !== undefined) {
      process.env.DEFERRED_CHAT_ACTIONS_ENABLED = originalFlag;
    } else {
      delete process.env.DEFERRED_CHAT_ACTIONS_ENABLED;
    }
  });

  it("returns 200 with message=Disabled when flag is not set", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Disabled");
    expect(body.fired).toBe(0);
    expect(body.failed).toBe(0);
  });

  it("returns 200 with message=Disabled when flag is explicitly false", async () => {
    process.env.DEFERRED_CHAT_ACTIONS_ENABLED = "false";
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Disabled");
  });
});

describe("GET /api/cron/deferred-chat-actions — successful dispatch", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret";
    process.env.DEFERRED_CHAT_ACTIONS_ENABLED = "true";
    const mod = await import("@/app/api/cron/deferred-chat-actions/route");
    GET = mod.GET;
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    delete process.env.DEFERRED_CHAT_ACTIONS_ENABLED;
  });

  it("returns { fired: 1, failed: 0, success: true } on clean dispatch", async () => {
    const { dispatchDueActions } = await import(
      "@/services/deferred-chat-action-dispatcher"
    );
    vi.mocked(dispatchDueActions).mockResolvedValue({
      fired: 1,
      failed: 0,
      errors: [],
    });

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.fired).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.errors).toHaveLength(0);
    expect(body.timestamp).toBeDefined();
  });

  it("returns success: false when there are failures", async () => {
    const { dispatchDueActions } = await import(
      "@/services/deferred-chat-action-dispatcher"
    );
    vi.mocked(dispatchDueActions).mockResolvedValue({
      fired: 0,
      failed: 1,
      errors: ["action-1: LLM unavailable"],
    });

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.fired).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.errors).toHaveLength(1);
  });

  it("returns 500 on an unhandled dispatcher exception", async () => {
    const { dispatchDueActions } = await import(
      "@/services/deferred-chat-action-dispatcher"
    );
    vi.mocked(dispatchDueActions).mockRejectedValue(
      new Error("DB connection lost"),
    );

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal server error");
  });
});

describe("GET /api/cron/deferred-chat-actions — vercel.json configuration", () => {
  it("has the cron registered with a per-minute schedule", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const vercelPath = path.join(process.cwd(), "vercel.json");
    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
    const cron = vercelConfig.crons?.find(
      (c: { path: string; schedule: string }) =>
        c.path === "/api/cron/deferred-chat-actions",
    );
    expect(cron).toBeDefined();
    expect(cron.schedule).toBe("* * * * *");
  });
});
