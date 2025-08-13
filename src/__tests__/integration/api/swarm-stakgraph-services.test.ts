import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/swarm/stakgraph/services/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getServerSession } from "next-auth/next";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

describe("GET /api/swarm/stakgraph/services", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_test_key_abc";

  beforeEach(async () => {
    vi.clearAllMocks();
    // Seed user, workspace and swarm
    const user = await db.user.create({
      data: {
        id: "user1",
        email: "user1@example.com",
        name: "User 1",
      },
    });
    const workspace = await db.workspace.create({
      data: {
        name: "w1",
        slug: "w1",
        ownerId: user.id,
      },
    });
    await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "s1-name",
        swarmId: "s1",
        status: "ACTIVE",
        swarmUrl: "https://s1-name.sphinx.chat/api",
        swarmApiKey: JSON.stringify(
          enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY),
        ),
        services: [],
      },
    });
    (
      getServerSession as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({
      user: { id: "user1" },
    });
  });

  it("proxies with decrypted header and keeps DB encrypted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ services: [] }),
      } as unknown as Response);

    const search = new URL(
      "http://localhost:3000/api/swarm/stakgraph/services?workspaceId=any&swarmId=s1",
    );
    const res = await GET(new NextRequest(search.toString()));

    expect(res.status).toBe(200);
    // Verify header used decrypted token
    const firstCall = fetchSpy.mock.calls[0] as [
      string,
      { headers?: Record<string, string> },
    ];
    const headers = (firstCall?.[1]?.headers || {}) as Record<string, string>;
    expect(Object.values(headers).join(" ")).toContain(PLAINTEXT_SWARM_API_KEY);

    // Verify DB is still encrypted (no plaintext present)
    const swarm = await db.swarm.findFirst({ where: { swarmId: "s1" } });
    const stored = swarm?.swarmApiKey || "";
    expect(stored).not.toContain(PLAINTEXT_SWARM_API_KEY);
  });
});
