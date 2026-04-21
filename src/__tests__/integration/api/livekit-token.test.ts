import { describe, it, expect, beforeEach, vi } from "vitest";
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
const mockAddGrant = vi.fn();
const mockToJwt = vi.fn(async () => "fake-livekit-jwt");

vi.mock("livekit-server-sdk", () => {
  return {
    AccessToken: vi.fn().mockImplementation(() => ({
      addGrant: mockAddGrant,
      toJwt: mockToJwt,
      metadata: "",
    })),
  };
});

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
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide the env the route expects; tests are hermetic so overwriting
    // is safe.
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
