import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "@/app/api/user/preferences/route";
import { getServerSession } from "next-auth";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const mockGetServerSession = getServerSession as Mock;

function makeRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/user/preferences", {
    method: body !== undefined ? "PATCH" : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/user/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  test("returns timezone in response", async () => {
    mockUserFindUnique.mockResolvedValue({
      canvasAutonomousTurns: true,
      chatAgentModel: null,
      timezone: "America/Chicago",
      activityRecapEnabled: true,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.timezone).toBe("America/Chicago");
  });

  test("falls back to 'UTC' when timezone is null", async () => {
    mockUserFindUnique.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: null,
      activityRecapEnabled: true,
    });

    const res = await GET();
    const body = await res.json();

    expect(body.timezone).toBe("UTC");
  });

  test("returns activityRecapEnabled in response", async () => {
    mockUserFindUnique.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: "UTC",
      activityRecapEnabled: false,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activityRecapEnabled).toBe(false);
  });

  test("returns activityRecapEnabled true by default", async () => {
    mockUserFindUnique.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: "UTC",
      activityRecapEnabled: true,
    });

    const res = await GET();
    const body = await res.json();

    expect(body.activityRecapEnabled).toBe(true);
  });

  test("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/user/preferences — timezone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  test("accepts a valid IANA timezone and returns 200 with updated timezone", async () => {
    mockUserUpdate.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: "America/Chicago",
      activityRecapEnabled: true,
    });

    const req = makeRequest({ timezone: "America/Chicago" });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.timezone).toBe("America/Chicago");
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ timezone: "America/Chicago" }),
      }),
    );
  });

  test("rejects an invalid IANA timezone string with 400", async () => {
    const req = makeRequest({ timezone: "Fake/Zone" });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid IANA timezone");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  test("rejects an arbitrary non-IANA string with 400", async () => {
    const req = makeRequest({ timezone: "not-a-timezone" });
    const res = await PATCH(req);

    expect(res.status).toBe(400);
  });

  test("accepts a PATCH without timezone (no-op for timezone field)", async () => {
    mockUserUpdate.mockResolvedValue({
      canvasAutonomousTurns: true,
      chatAgentModel: null,
      timezone: "UTC",
      activityRecapEnabled: true,
    });

    const req = makeRequest({ canvasAutonomousTurns: true });
    const res = await PATCH(req);

    expect(res.status).toBe(200);
    // timezone field should not be included in update data when not sent
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ timezone: expect.anything() }),
      }),
    );
  });

  test("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = makeRequest({ timezone: "America/New_York" });
    const res = await PATCH(req);

    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/user/preferences — activityRecapEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  test("updates activityRecapEnabled to false and returns it in the response", async () => {
    mockUserUpdate.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: "UTC",
      activityRecapEnabled: false,
    });

    const req = makeRequest({ activityRecapEnabled: false });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activityRecapEnabled).toBe(false);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activityRecapEnabled: false }),
      }),
    );
  });

  test("updates activityRecapEnabled to true", async () => {
    mockUserUpdate.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: "UTC",
      activityRecapEnabled: true,
    });

    const req = makeRequest({ activityRecapEnabled: true });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activityRecapEnabled).toBe(true);
  });

  test("rejects non-boolean activityRecapEnabled with 400", async () => {
    const req = makeRequest({ activityRecapEnabled: "yes" });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("activityRecapEnabled must be a boolean");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  test("does not include activityRecapEnabled in update when not provided", async () => {
    mockUserUpdate.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: "UTC",
      activityRecapEnabled: true,
    });

    const req = makeRequest({ canvasAutonomousTurns: false });
    const res = await PATCH(req);

    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ activityRecapEnabled: expect.anything() }),
      }),
    );
  });
});

describe("PATCH /api/user/preferences — voiceLearningEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  test("rejects non-boolean voiceLearningEnabled with 400", async () => {
    const req = makeRequest({ voiceLearningEnabled: "yes" });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("voiceLearningEnabled must be a boolean");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  test("updates voiceLearningEnabled to true and returns it", async () => {
    mockUserUpdate.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: "UTC",
      activityRecapEnabled: true,
      voiceLearningEnabled: true,
    });

    const req = makeRequest({ voiceLearningEnabled: true });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.voiceLearningEnabled).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ voiceLearningEnabled: true }),
      }),
    );
  });

  test("updates voiceLearningEnabled to false", async () => {
    mockUserUpdate.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: "UTC",
      activityRecapEnabled: true,
      voiceLearningEnabled: false,
    });

    const req = makeRequest({ voiceLearningEnabled: false });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.voiceLearningEnabled).toBe(false);
  });

  test("does not include voiceLearningEnabled in update when not provided", async () => {
    mockUserUpdate.mockResolvedValue({
      canvasAutonomousTurns: false,
      chatAgentModel: null,
      timezone: "UTC",
      activityRecapEnabled: true,
      voiceLearningEnabled: false,
    });

    const req = makeRequest({ canvasAutonomousTurns: false });
    const res = await PATCH(req);

    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ voiceLearningEnabled: expect.anything() }),
      }),
    );
  });
});
