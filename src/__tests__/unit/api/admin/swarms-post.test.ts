import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
  },
}));

vi.mock("@/services/ec2", () => ({
  listSuperadminInstances: vi.fn(),
}));

vi.mock("@/lib/utils/password", () => ({
  generateSecurePassword: vi.fn(() => "auto-generated-pw"),
}));

vi.mock("@/services/swarm", () => ({
  SwarmService: vi.fn(),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(() => ({ baseUrl: "http://mock", apiKey: "key" })),
}));

vi.mock("@/lib/constants", () => ({
  SWARM_DEFAULT_INSTANCE_TYPE: "m6i.xlarge",
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { POST } from "@/app/api/admin/swarms/route";
import { db } from "@/lib/db";
import { generateSecurePassword } from "@/lib/utils/password";
import { SwarmService } from "@/services/swarm";

const mockDb = db as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
};
const mockGenerateSecurePassword = generateSecurePassword as ReturnType<typeof vi.fn>;
const MockSwarmService = SwarmService as unknown as ReturnType<typeof vi.fn>;

const SUPER_ADMIN_USER_ID = "user-super-admin";
const mockCreateSwarm = vi.fn();

function makeRequest(
  userId: string | null,
  body: Record<string, unknown>
): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (userId) {
    headers[MIDDLEWARE_HEADERS.USER_ID] = userId;
  }
  return new NextRequest("http://localhost/api/admin/swarms", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  MockSwarmService.mockImplementation(() => ({
    createSwarm: mockCreateSwarm,
  }));
});

describe("POST /api/admin/swarms", () => {
  it("returns 401 when no user header", async () => {
    const req = makeRequest(null, {});
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not SUPER_ADMIN", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    const req = makeRequest(SUPER_ADMIN_USER_ID, {});
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("creates a swarm with graph_mindset workspace_type", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockCreateSwarm.mockResolvedValue({
      success: true,
      message: "Swarm created",
      data: {
        swarm_id: "swarm-123",
        address: "http://swarm.example.com",
        ec2_id: "i-abc123",
        x_api_key: "key-xyz",
      },
    });

    const req = makeRequest(SUPER_ADMIN_USER_ID, {
      password: "mypassword",
      workspace_type: "graph_mindset",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.swarm_id).toBe("swarm-123");
    expect(body.password).toBe("mypassword");

    expect(mockCreateSwarm).toHaveBeenCalledWith({
      instance_type: "m6i.xlarge",
      password: "mypassword",
      workspace_type: "graph_mindset",
    });
  });

  it("creates a swarm without workspace_type when type is Other", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockCreateSwarm.mockResolvedValue({
      success: true,
      message: "Swarm created",
      data: {
        swarm_id: "swarm-456",
        address: "http://other.example.com",
        ec2_id: "i-def456",
        x_api_key: "key-abc",
      },
    });

    const req = makeRequest(SUPER_ADMIN_USER_ID, {
      password: "mypassword",
      // no workspace_type
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    // workspace_type should be omitted entirely
    expect(mockCreateSwarm).toHaveBeenCalledWith({
      instance_type: "m6i.xlarge",
      password: "mypassword",
    });
    const callArg = mockCreateSwarm.mock.calls[0][0];
    expect("workspace_type" in callArg).toBe(false);
  });

  it("auto-generates password when none is provided", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockGenerateSecurePassword.mockReturnValue("auto-generated-pw");
    mockCreateSwarm.mockResolvedValue({
      success: true,
      message: "Swarm created",
      data: {
        swarm_id: "swarm-789",
        address: "http://auto.example.com",
        ec2_id: "i-ghi789",
        x_api_key: "key-auto",
      },
    });

    const req = makeRequest(SUPER_ADMIN_USER_ID, {
      // no password
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.password).toBe("auto-generated-pw");
    expect(mockGenerateSecurePassword).toHaveBeenCalled();

    expect(mockCreateSwarm).toHaveBeenCalledWith(
      expect.objectContaining({ password: "auto-generated-pw" })
    );
  });

  it("returns 500 on swarm service error", async () => {
    mockDb.user.findUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockCreateSwarm.mockRejectedValue(new Error("Service unavailable"));

    const req = makeRequest(SUPER_ADMIN_USER_ID, { password: "pw" });
    const res = await POST(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
