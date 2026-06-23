import { NextRequest, NextResponse } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotificationTriggerType } from "@prisma/client";
import { GET, PATCH } from "@/app/api/user/notification-preferences/route";
import { DEFAULT_NOTIFICATION_PREFS } from "@/lib/notifications/preferences";

// --- mocks -----------------------------------------------------------

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------

const MOCK_USER = { id: "user-1", email: "u@test.com", name: "Test" };

function makeGetRequest(): NextRequest {
  return new NextRequest("http://localhost/api/user/notification-preferences", {
    method: "GET",
  });
}

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/user/notification-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authenticatedAs(user = MOCK_USER) {
  vi.mocked(getMiddlewareContext).mockReturnValue({ authStatus: "authenticated", user } as never);
  vi.mocked(requireAuth).mockReturnValue(user as never);
}

function unauthenticated() {
  vi.mocked(getMiddlewareContext).mockReturnValue({ authStatus: "error" } as never);
  vi.mocked(requireAuth).mockReturnValue(
    NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  );
}

// ---------------------------------------------------------------------

describe("GET /api/user/notification-preferences", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    unauthenticated();
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns 404 when user not found", async () => {
    authenticatedAs();
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(404);
  });

  it("returns all defaults when user has no stored preferences (null)", async () => {
    authenticatedAs();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      notificationPreferences: null,
    } as never);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("returns all defaults when user has empty stored preferences ({})", async () => {
    authenticatedAs();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      notificationPreferences: {},
    } as never);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("merges stored preferences with defaults", async () => {
    authenticatedAs();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      notificationPreferences: { TASK_ASSIGNED: false },
    } as never);

    const res = await GET(makeGetRequest());
    const body = await res.json();
    expect(body.TASK_ASSIGNED).toBe(false);
    expect(body.FEATURE_ASSIGNED).toBe(true);
    expect(body.GRAPH_CHAT_RESPONSE).toBe(false);
  });
});

describe("PATCH /api/user/notification-preferences", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    unauthenticated();
    const res = await PATCH(makePatchRequest({ TASK_ASSIGNED: false }));
    expect(res.status).toBe(401);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid notification type key", async () => {
    authenticatedAs();
    const res = await PATCH(makePatchRequest({ INVALID_KEY: false }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid notification type/);
  });

  it("returns 400 when value is a non-boolean", async () => {
    authenticatedAs();
    const res = await PATCH(makePatchRequest({ TASK_ASSIGNED: "yes" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/must be a boolean/);
  });

  it("returns 400 when body is not a JSON object", async () => {
    authenticatedAs();
    const req = new NextRequest("http://localhost/api/user/notification-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "not-json{{{",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when user not found", async () => {
    authenticatedAs();
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);
    const res = await PATCH(makePatchRequest({ TASK_ASSIGNED: false }));
    expect(res.status).toBe(404);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("persists the update and returns merged preferences", async () => {
    authenticatedAs();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      notificationPreferences: {},
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);

    const res = await PATCH(makePatchRequest({ TASK_ASSIGNED: false }));
    expect(res.status).toBe(200);

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { notificationPreferences: { TASK_ASSIGNED: false } },
    });

    const body = await res.json();
    expect(body.TASK_ASSIGNED).toBe(false);
    // Other defaults still present
    expect(body.FEATURE_ASSIGNED).toBe(true);
  });

  it("merges partial update preserving existing stored keys", async () => {
    authenticatedAs();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      notificationPreferences: { FEATURE_ASSIGNED: false },
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);

    const res = await PATCH(makePatchRequest({ TASK_ASSIGNED: false }));
    expect(res.status).toBe(200);

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { notificationPreferences: { FEATURE_ASSIGNED: false, TASK_ASSIGNED: false } },
    });

    const body = await res.json();
    expect(body.TASK_ASSIGNED).toBe(false);
    expect(body.FEATURE_ASSIGNED).toBe(false);
  });

  it("allows enabling GRAPH_CHAT_RESPONSE explicitly", async () => {
    authenticatedAs();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      notificationPreferences: {},
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);

    const res = await PATCH(
      makePatchRequest({ [NotificationTriggerType.GRAPH_CHAT_RESPONSE]: true })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.GRAPH_CHAT_RESPONSE).toBe(true);
  });

  it("accepts an empty update body (no-op)", async () => {
    authenticatedAs();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      notificationPreferences: {},
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({} as never);

    const res = await PATCH(makePatchRequest({}));
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { notificationPreferences: {} },
    });
  });
});
