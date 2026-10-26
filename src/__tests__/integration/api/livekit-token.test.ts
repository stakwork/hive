import { describe, it, expect, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { POST } from "@/app/api/livekit-token/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedPostRequest,
  createPostRequest,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

// Mock the LiveKit SDK to avoid signing real AccessTokens during the test
// run. We only care that our route validates workspace access *before*
// calling into LiveKit — so a stub that tracks invocations is enough.
const { mockAddGrant, mockToJwt, mockCreateDispatch, tokens } = vi.hoisted(() => ({
  mockAddGrant: vi.fn(),
  mockToJwt: vi.fn(async () => "fake-livekit-jwt"),
  mockCreateDispatch: vi.fn().mockResolvedValue({}),
  /** Every AccessToken the route built, to check what it carries. */
  tokens: [] as Array<{ metadata: string }>,
}));

vi.mock("livekit-server-sdk", () => {
  return {
    AccessToken: vi.fn().mockImplementation(() => {
      const token = { addGrant: mockAddGrant, toJwt: mockToJwt, metadata: "" };
      tokens.push(token);
      return token;
    }),
    AgentDispatchClient: vi.fn().mockImplementation(() => ({ createDispatch: mockCreateDispatch })),
  };
});

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn(),
  },
}));

async function createOwnerAndWorkspace() {
  const owner = await db.user.create({
    data: {
      id: generateUniqueId("lk-owner"),
      email: `lk-owner-${generateUniqueId()}@example.com`,
      name: "LK Owner",
    },
  });
  const workspace = await db.workspace.create({
    data: {
      id: generateUniqueId("lk-ws"),
      name: "LK Workspace",
      slug: generateUniqueSlug("lk-ws"),
      ownerId: owner.id,
    },
  });
  return { owner, workspace };
}

describe("POST /api/livekit-token", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tokens.length = 0;
    mockCreateDispatch.mockResolvedValue({});
    const { redis } = await import("@/lib/redis");
    vi.mocked(redis.set).mockResolvedValue("OK");
    // Provide the env the route expects; tests are hermetic so overwriting
    // is safe.
    process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "test-livekit-key";
    process.env.LIVEKIT_API_SECRET = "test-livekit-secret";
    process.env.JWT_SECRET = "test-jwt-secret";
  });

  it("returns 401 when request is unauthenticated", async () => {
    const req = createPostRequest("http://localhost:3000/api/livekit-token", {
      slug: "anything",
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockToJwt).not.toHaveBeenCalled();
  });

  it("returns 400 when slug is missing", async () => {
    const { owner } = await createOwnerAndWorkspace();

    const req = createAuthenticatedPostRequest(
      "http://localhost:3000/api/livekit-token",
      owner,
      {},
    );

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("slug is required");
    expect(mockToJwt).not.toHaveBeenCalled();
  });

  it("signs a token when caller owns the workspace", async () => {
    const { owner, workspace } = await createOwnerAndWorkspace();

    const req = createAuthenticatedPostRequest(
      "http://localhost:3000/api/livekit-token",
      owner,
      { slug: workspace.slug },
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toBe("fake-livekit-jwt");
    expect(json.roomName).toMatch(new RegExp(`^hive-${workspace.slug}-\\d+$`));
    expect(mockToJwt).toHaveBeenCalledTimes(1);
  });

  it("hands the Hive token to Jamie's dispatch, never to participant metadata", async () => {
    const { owner, workspace } = await createOwnerAndWorkspace();

    const req = createAuthenticatedPostRequest(
      "http://localhost:3000/api/livekit-token",
      owner,
      { slug: workspace.slug },
    );

    const res = await POST(req);
    expect(res.status).toBe(200);
    const { roomName } = await res.json();

    // Every participant can read participant metadata: nothing goes there.
    expect(tokens).toHaveLength(1);
    expect(tokens[0].metadata).toBe("");

    // Jamie is dispatched into the room with an opaque callKey…
    expect(mockCreateDispatch).toHaveBeenCalledTimes(1);
    const [dispatchedRoom, agentName, options] = mockCreateDispatch.mock.calls[0];
    expect(dispatchedRoom).toBe(roomName);
    expect(agentName).toBe("jamie");
    const { callKey } = JSON.parse(options.metadata);
    expect(callKey).toMatch(/^[0-9a-f]{24}$/);

    // …that stands for a workspace token for this user, kept in Redis.
    const { redis } = await import("@/lib/redis");
    const [key, storedToken, ex, ttl] = vi.mocked(redis.set).mock.calls[0];
    expect([key, ex, ttl]).toEqual([`call-token:${callKey}`, "EX", 7200]);
    const payload = jwt.verify(storedToken as string, "test-jwt-secret") as Record<string, unknown>;
    expect(payload).toMatchObject({ slug: workspace.slug, userId: owner.id });
  });

  it("returns 502 and drops the callKey when the dispatch fails", async () => {
    mockCreateDispatch.mockRejectedValueOnce(new Error("twirp error: unavailable"));
    const { owner, workspace } = await createOwnerAndWorkspace();

    const req = createAuthenticatedPostRequest(
      "http://localhost:3000/api/livekit-token",
      owner,
      { slug: workspace.slug },
    );

    const res = await POST(req);

    expect(res.status).toBe(502);
    expect(mockToJwt).not.toHaveBeenCalled();
    const { redis } = await import("@/lib/redis");
    expect(vi.mocked(redis.del)).toHaveBeenCalledWith(vi.mocked(redis.set).mock.calls[0][0]);
  });

  describe("IDOR hardening", () => {
    it("returns 404 when caller is not a member of the workspace", async () => {
      const { workspace } = await createOwnerAndWorkspace();

      // Attacker knows the victim's slug but is not a member.
      const attacker = await db.user.create({
        data: {
          id: generateUniqueId("lk-attacker"),
          email: `lk-attacker-${generateUniqueId()}@example.com`,
          name: "Attacker",
        },
      });

      const req = createAuthenticatedPostRequest(
        "http://localhost:3000/api/livekit-token",
        attacker,
        { slug: workspace.slug },
      );

      const res = await POST(req);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Workspace not found or access denied");
      // JWT must never be signed for non-members — otherwise they could
      // drive MCP against the victim's swarm.
      expect(mockToJwt).not.toHaveBeenCalled();
    });

    it("returns 404 for a slug that does not resolve to any workspace", async () => {
      const user = await db.user.create({
        data: {
          id: generateUniqueId("lk-user"),
          email: `lk-user-${generateUniqueId()}@example.com`,
          name: "User",
        },
      });

      const req = createAuthenticatedPostRequest(
        "http://localhost:3000/api/livekit-token",
        user,
        { slug: "no-such-slug-exists" },
      );

      const res = await POST(req);

      expect(res.status).toBe(404);
      expect(mockToJwt).not.toHaveBeenCalled();
    });
  });
});
