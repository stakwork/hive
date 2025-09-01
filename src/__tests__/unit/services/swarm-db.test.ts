import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

describe("saveOrUpdateSwarm - Password Encryption", () => {
  const enc = EncryptionService.getInstance();
  let workspace: { id: string };

  beforeEach(async () => {
    // Create test workspace
    const user = await db.user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    });

    workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: user.id,
      },
    });
  });

  afterEach(async () => {
    await db.swarm.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
  });

  it("encrypts password when creating new swarm", async () => {
    const testPassword = "TestPassword123!@#";
    
    const swarm = await saveOrUpdateSwarm({
      workspaceId: workspace.id,
      name: "test-swarm",
      swarmPassword: testPassword,
      instanceType: "XL",
    });

    expect(swarm.swarmPassword).toBeDefined();
    expect(swarm.swarmPassword).not.toBe(testPassword);
    
    // Verify it's encrypted JSON
    const parsed = JSON.parse(swarm.swarmPassword as string);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("tag");
    
    // Verify decryption works
    const decrypted = enc.decryptField("swarmPassword", swarm.swarmPassword as string);
    expect(decrypted).toBe(testPassword);
  });

  it("updates password when updating existing swarm", async () => {
    // Create initial swarm
    await saveOrUpdateSwarm({
      workspaceId: workspace.id,
      name: "test-swarm",
      swarmPassword: "InitialPassword123!",
      instanceType: "XL",
    });

    // Update with new password
    const newPassword = "UpdatedPassword456!";
    const updated = await saveOrUpdateSwarm({
      workspaceId: workspace.id,
      swarmPassword: newPassword,
    });

    // Verify new password is encrypted
    const decrypted = enc.decryptField("swarmPassword", updated.swarmPassword as string);
    expect(decrypted).toBe(newPassword);
  });

  it("does not modify password if not provided in update", async () => {
    const originalPassword = "OriginalPassword789!";
    
    // Create swarm with password
    await saveOrUpdateSwarm({
      workspaceId: workspace.id,
      name: "test-swarm",
      swarmPassword: originalPassword,
      instanceType: "XL",
    });

    // Update without password
    const updated = await saveOrUpdateSwarm({
      workspaceId: workspace.id,
      status: "ACTIVE",
    });

    // Password should remain unchanged
    const decrypted = enc.decryptField("swarmPassword", updated.swarmPassword as string);
    expect(decrypted).toBe(originalPassword);
  });
});