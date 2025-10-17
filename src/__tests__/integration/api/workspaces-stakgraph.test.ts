import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  GET as GET_STAK,
} from "@/app/api/workspaces/[slug]/stakgraph/route";
import { db } from "@/lib/db";
import type { User, Workspace, Swarm } from "@prisma/client";
import { encryptEnvVars } from "@/lib/encryption";
import {
  generateUniqueId,
  generateUniqueSlug,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers";

describe("/api/workspaces/[slug]/stakgraph", () => {
  const PLAINTEXT_ENV = [{ name: "SECRET", value: "my_value" }];
  let testData: { user: User; workspace: Workspace; swarm: Swarm };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Don't manually clean - let the global cleanup handle it
    // Use transaction to atomically create test data
    testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "User 2",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "w2",
          slug: generateUniqueSlug("w2"),
          ownerId: user.id,
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: generateUniqueId("s2"),
          status: "ACTIVE",
          // @ts-expect-error - encryptEnvVars returns correct type for Prisma Json field
          environmentVariables: encryptEnvVars(PLAINTEXT_ENV),
          services: [],
          agentRequestId: null,
          agentStatus: null,
        },
      });

      return { user, workspace, swarm };
    });
  });

  it("GET returns decrypted env vars but DB remains encrypted", async () => {
    const req = createAuthenticatedGetRequest(
      `/api/workspaces/${testData.workspace.slug}/stakgraph`,
      { id: testData.user.id, email: testData.user.email || "", name: testData.user.name || "" }
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
