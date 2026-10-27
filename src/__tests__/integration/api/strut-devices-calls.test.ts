import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/strut-devices/calls/route";
import { createTestUser, createTestWorkspaceScenario } from "@/__tests__/support/fixtures";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/api-keys";
import { generateDeviceCredential } from "@/lib/strut-devices";

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn(),
  },
}));

const { CALL_BASE, callBaseState } = vi.hoisted(() => {
  const base = "https://call.example.com/rooms/sphinx.call.-";
  return { CALL_BASE: base, callBaseState: { value: base as string | undefined } };
});
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    optionalEnvVars: {
      ...actual.optionalEnvVars,
      get LIVEKIT_CALL_BASE_URL() {
        return callBaseState.value;
      },
    },
  };
});

const { mockCreateDispatch } = vi.hoisted(() => ({
  mockCreateDispatch: vi.fn().mockResolvedValue({}),
}));
vi.mock("livekit-server-sdk", () => ({
  AgentDispatchClient: vi.fn().mockImplementation(() => ({ createDispatch: mockCreateDispatch })),
}));

async function createOrgWorkspaceScenario(options: Parameters<typeof createTestWorkspaceScenario>[0] = {}) {
  const org = await db.sourceControlOrg.create({
    data: {
      id: generateUniqueId("test-org"),
      githubLogin: `org-${generateUniqueId()}`,
      githubInstallationId: Math.floor(Math.random() * 1_000_000_000),
      type: "ORG",
    },
  });
  const scenario = await createTestWorkspaceScenario({
    ...options,
    workspace: { ...options.workspace, sourceControlOrgId: org.id },
  });
  return { ...scenario, org };
}

async function createDevice(userId: string, revoked = false) {
  const credential = generateDeviceCredential();
  await db.strutDevice.create({
    data: {
      userId,
      name: "Peel",
      credentialPrefix: credential.slice(0, 12),
      credentialHash: hashApiKey(credential),
      revokedAt: revoked ? new Date() : null,
    },
  });
  return credential;
}

function callRequest(credential: string | null, body?: unknown, raw?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (credential) headers.Authorization = `Bearer ${credential}`;
  return new NextRequest("http://localhost:3000/api/strut-devices/calls", {
    method: "POST",
    headers,
    body: raw ?? JSON.stringify(body ?? {}),
  });
}

describe("POST /api/strut-devices/calls", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    callBaseState.value = CALL_BASE;
    const { redis } = await import("@/lib/redis");
    vi.mocked(redis.set).mockResolvedValue("OK");
    mockCreateDispatch.mockResolvedValue({});
    process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "test-livekit-key";
    process.env.LIVEKIT_API_SECRET = "test-livekit-secret";
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
  });

  async function setup(options: Parameters<typeof createTestWorkspaceScenario>[0] = {}) {
    const scenario = await createOrgWorkspaceScenario({
      withSwarm: true,
      swarm: { status: "ACTIVE", name: "swarm77" },
      ...options,
    });
    const credential = await createDevice(scenario.owner.id);
    return { ...scenario, credential };
  }

  test("401 without an Authorization header", async () => {
    const { workspace } = await setup();
    const res = await POST(callRequest(null, { workspace: workspace.slug }));
    expect(res.status).toBe(401);
    expect(mockCreateDispatch).not.toHaveBeenCalled();
  });

  test("401 for an unknown credential", async () => {
    const { workspace } = await setup();
    const res = await POST(callRequest(generateDeviceCredential(), { workspace: workspace.slug }));
    expect(res.status).toBe(401);
  });

  test("401 for a revoked credential", async () => {
    const { owner, workspace } = await setup();
    const revoked = await createDevice(owner.id, true);
    const res = await POST(callRequest(revoked, { workspace: workspace.slug }));
    expect(res.status).toBe(401);
    expect(mockCreateDispatch).not.toHaveBeenCalled();
  });

  test("200 with a url for a valid credential", async () => {
    const { workspace, credential, owner, org } = await setup();
    const res = await POST(callRequest(credential, { workspace: workspace.slug }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toMatch(/^https:\/\/call\.example\.com\/rooms\/sphinx\.call\.-swarm77\.sphinx\.chat-\.\d+$/);
    expect(mockCreateDispatch).toHaveBeenCalledTimes(1);
    const { redis } = await import("@/lib/redis");
    const writes = vi.mocked(redis.set).mock.calls;
    const record = writes.find(([k]) => /^call:/.test(k as string));
    expect(JSON.parse(record![1] as string)).toMatchObject({
      userId: owner.id,
      orgId: org.id,
      workspaceSlug: workspace.slug,
    });
  });

  test("dispatch metadata carries transcript:true only when the workflow env is set", async () => {
    const { workspace, credential } = await setup();
    const saved = process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
    try {
      for (const [wf, expected] of [
        [undefined, undefined],
        ["call-transcript", true],
      ] as const) {
        if (wf === undefined) delete process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
        else process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME = wf;
        mockCreateDispatch.mockClear();
        const res = await POST(callRequest(credential, { workspace: workspace.slug }));
        expect(res.status).toBe(200);
        const meta = JSON.parse(mockCreateDispatch.mock.calls[0][2].metadata);
        expect(meta.transcript).toBe(expected);
      }
    } finally {
      if (saved === undefined) delete process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
      else process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME = saved;
    }
  });

  test("400 when workspace is missing from the body", async () => {
    const { credential } = await setup();
    const res = await POST(callRequest(credential, {}));
    expect(res.status).toBe(400);
  });

  test("400 when workspace is not a string", async () => {
    const { credential } = await setup();
    const res = await POST(callRequest(credential, { workspace: 5 }));
    expect(res.status).toBe(400);
  });

  test("400 when the body is not JSON", async () => {
    const { credential } = await setup();
    const res = await POST(callRequest(credential, undefined, "nope"));
    expect(res.status).toBe(400);
  });

  test("404 for an unknown workspace", async () => {
    const { credential } = await setup();
    const res = await POST(callRequest(credential, { workspace: "no-such-workspace" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Workspace not found");
  });

  test("403 for a workspace the device's person cannot reach", async () => {
    const { workspace } = await setup();
    const outsider = await createTestUser();
    const credential = await createDevice(outsider.id);
    const res = await POST(callRequest(credential, { workspace: workspace.slug }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Access denied");
    expect(mockCreateDispatch).not.toHaveBeenCalled();
  });

  test("400 when the workspace has no org", async () => {
    const scenario = await createTestWorkspaceScenario({
      withSwarm: true,
      swarm: { status: "ACTIVE", name: "swarm78" },
    });
    const credential = await createDevice(scenario.owner.id);
    const res = await POST(callRequest(credential, { workspace: scenario.workspace.slug }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Workspace is not linked to a source-control org");
  });

  test("400 when the swarm is not active", async () => {
    const { workspace, credential } = await setup({
      withSwarm: true,
      swarm: { status: "PENDING", name: "swarm79" },
    });
    const res = await POST(callRequest(credential, { workspace: workspace.slug }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Swarm not configured or not active");
  });

  test("503 when LiveKit is not configured", async () => {
    callBaseState.value = undefined;
    const { workspace, credential } = await setup();
    const res = await POST(callRequest(credential, { workspace: workspace.slug }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("LiveKit call service not configured");
    expect(mockCreateDispatch).not.toHaveBeenCalled();
  });

  test("502 and nothing left behind when the dispatch fails", async () => {
    mockCreateDispatch.mockRejectedValueOnce(new Error("twirp error"));
    const { workspace, credential } = await setup();
    const res = await POST(callRequest(credential, { workspace: workspace.slug }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Could not start Jamie for the call");
    const { redis } = await import("@/lib/redis");
    const storedKey = vi.mocked(redis.set).mock.calls[0][0] as string;
    expect(vi.mocked(redis.del)).toHaveBeenCalledWith(storedKey);
    expect(vi.mocked(redis.del)).toHaveBeenCalledWith(`call:${storedKey.replace(/^call-token:/, "")}`);
  });
});
