import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GET as GET_STAK,
  POST as POST_STAK,
} from "@/app/api/workspaces/[slug]/stakgraph/route";
import { db } from "@/lib/db";
import { encryptEnvVars } from "@/lib/encryption";
import { getServerSession } from "next-auth/next";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

describe("/api/workspaces/[slug]/stakgraph", () => {
  const PLAINTEXT_ENV = [{ name: "SECRET", value: "my_value" }];

  beforeEach(async () => {
    vi.clearAllMocks();
    const workspace = await db.workspace.create({
      data: {
        name: "w2",
        slug: "w2",
        owner: "user2@example.com",
      },
    });
    await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: "s2",
        status: "ACTIVE",
        environmentVariables: encryptEnvVars(PLAINTEXT_ENV as any) as any,
        services: [],
      },
    });
    (getServerSession as any).mockResolvedValue({ user: { id: "user2" } });
  });

  it("GET returns decrypted env vars but DB remains encrypted", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/workspaces/w2/stakgraph",
    );
    const res = await GET_STAK(req, {
      params: Promise.resolve({ slug: "w2" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const envVars = data.settings.environmentVariables as Array<{
      name: string;
      value: string;
    }>;
    expect(envVars).toEqual(PLAINTEXT_ENV);

    const swarm = await db.swarm.findFirst({ where: { name: "s2" } });
    const stored = swarm?.environmentVariables as unknown as string;
    expect(JSON.stringify(stored)).not.toContain("my_value");
  });
});
