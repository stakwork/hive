import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/swarm/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getServerSession } from "next-auth/next";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/services/swarm", () => ({
  SwarmService: vi.fn().mockImplementation(() => ({
    createSwarm: vi.fn().mockResolvedValue({
      success: true,
      message: "Swarm created",
      data: { swarm_id: "test-swarm-123" },
    }),
  })),
}));

describe("POST /api/swarm - Password Generation", () => {
  const enc = EncryptionService.getInstance();
  let workspace: { id: string };
  let user: { id: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create test user and workspace
    user = await db.user.create({
      data: {
        id: "test-user-1",
        email: "test@example.com",
        name: "Test User",
      },
    });

    workspace = await db.workspace.create({
      data: {
        id: "test-workspace-1",
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: user.id,
      },
    });

    // Mock session
    (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ user: { id: user.id } });
  });

  afterEach(async () => {
    // Clean up
    await db.swarm.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
  });

  it("generates and encrypts password for new swarm", async () => {
    const request = new NextRequest("http://localhost:3000/api/swarm", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspace.id,
        name: "TestSwarm",
        repositoryName: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        repositoryDescription: "Test repository",
        repositoryDefaultBranch: "main",
      }),
    });

    const response = await POST(request);
    const responseData = await response.json();

    expect(response.status).toBe(200);
    expect(responseData.success).toBe(true);
    expect(responseData.data.swarm_id).toBe("test-swarm-123");

    // Verify password was encrypted and stored
    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspace.id },
    });

    expect(swarm).toBeDefined();
    expect(swarm?.swarmPassword).toBeDefined();
    
    // Password should be encrypted (JSON string)
    expect(swarm?.swarmPassword).toMatch(/^{.*}$/);
    
    // Decrypt and verify it's a valid password
    const decrypted = enc.decryptField(
      "swarmPassword",
      swarm?.swarmPassword as string
    );
    
    // Check password characteristics
    expect(decrypted).toHaveLength(20);
    expect(/[A-Z]/.test(decrypted)).toBe(true);
    expect(/[a-z]/.test(decrypted)).toBe(true);
    expect(/[0-9]/.test(decrypted)).toBe(true);
    expect(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(decrypted)).toBe(true);
  });

  it("stores encrypted password in database", async () => {
    const request = new NextRequest("http://localhost:3000/api/swarm", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspace.id,
        name: "TestSwarm2",
        repositoryName: "test-repo-2",
        repositoryUrl: "https://github.com/test/repo2",
      }),
    });

    await POST(request);

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspace.id },
    });

    // Verify password is encrypted (not plaintext)
    const storedPassword = swarm?.swarmPassword || "";
    
    // Should be valid JSON
    expect(() => JSON.parse(storedPassword)).not.toThrow();
    
    // Should have encryption structure
    const parsed = JSON.parse(storedPassword);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("tag");
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("encryptedAt");
  });
});