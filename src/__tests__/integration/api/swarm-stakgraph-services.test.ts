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
  let workspaceId: string;
  let swarmId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Don't manually clean - let the global cleanup handle it
    // Use transaction to atomically create test data
    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: `user-${Date.now()}-${Math.random()}`,
          email: `user-${Date.now()}@example.com`,
          name: "User 1",
        },
      });
      
      const workspace = await tx.workspace.create({
        data: {
          name: "w1",
          slug: `w1-${Date.now()}-${Math.random()}`,
          ownerId: user.id,
        },
      });
      
      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "s1-name",
          swarmId: `s1-${Date.now()}`,
          status: "ACTIVE",
          swarmUrl: "https://s1-name.sphinx.chat/api",
          swarmApiKey: JSON.stringify(
            enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY),
          ),
          services: [],
        },
      });
      
      return { user, workspace, swarm };
    });
    
    workspaceId = testData.workspace.id;
    swarmId = testData.swarm.swarmId!;
    
    (
      getServerSession as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({
      user: { id: testData.user.id },
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
      `http://localhost:3000/api/swarm/stakgraph/services?workspaceId=${workspaceId}&swarmId=${swarmId}`,
    );
    const res = await GET(new NextRequest(search.toString()));
    
    const responseBody = await res.json();
    console.log("Swarm API Response status:", res.status);
    console.log("Swarm API Response body:", JSON.stringify(responseBody, null, 2));

    expect(res.status).toBe(200);
    // Verify header used decrypted token
    const firstCall = fetchSpy.mock.calls[0] as [
      string,
      { headers?: Record<string, string> },
    ];
    const headers = (firstCall?.[1]?.headers || {}) as Record<string, string>;
    expect(Object.values(headers).join(" ")).toContain(PLAINTEXT_SWARM_API_KEY);

    // Verify DB is still encrypted (no plaintext present)
    const swarm = await db.swarm.findFirst({ where: { swarmId } });
    const stored = swarm?.swarmApiKey || "";
    expect(stored).not.toContain(PLAINTEXT_SWARM_API_KEY);
  });
});
