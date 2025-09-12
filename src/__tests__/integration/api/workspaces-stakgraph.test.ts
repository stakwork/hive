import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GET as GET_STAK,
  PUT as PUT_STAK,
} from "@/app/api/workspaces/[slug]/stakgraph/route";
import { db } from "@/lib/db";
import { encryptEnvVars } from "@/lib/encryption";
import { getServerSession } from "next-auth/next";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

describe("/api/workspaces/[slug]/stakgraph", () => {
  const PLAINTEXT_ENV = [{ name: "SECRET", value: "my_value" }];
  let testData: { user: any; workspace: any; swarm: any };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Don't manually clean - let the global cleanup handle it
    // Use transaction to atomically create test data
    testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: `user-${Date.now()}-${Math.random()}`,
          email: `user-${Date.now()}@example.com`,
          name: "User 2",
        },
      });
      
      const workspace = await tx.workspace.create({
        data: {
          name: "w2",
          slug: `w2-${Date.now()}-${Math.random()}`,
          ownerId: user.id,
        },
      });
      
      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: `s2-${Date.now()}`,
          status: "ACTIVE",
          environmentVariables: encryptEnvVars(PLAINTEXT_ENV as any) as any,
          services: [],
        },
      });
      
      return { user, workspace, swarm };
    });
    
    (getServerSession as any).mockResolvedValue({ user: { id: testData.user.id } });
  });

  it("GET returns decrypted env vars but DB remains encrypted", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
    );
    const res = await GET_STAK(req, {
      params: Promise.resolve({ slug: testData.workspace.slug }),
    });
    const response = await res.json();
    console.log("Response status:", res.status);
    console.log("Response body:", JSON.stringify(response, null, 2));
    
    expect(res.status).toBe(200);
    const envVars = response.data.environmentVariables as Array<{
      name: string;
      value: string;
    }>;
    expect(envVars).toEqual(PLAINTEXT_ENV);

    const swarm = await db.swarm.findFirst({ where: { name: testData.swarm.name } });
    const stored = swarm?.environmentVariables as unknown as string;
    expect(JSON.stringify(stored)).not.toContain("my_value");
  });
});
