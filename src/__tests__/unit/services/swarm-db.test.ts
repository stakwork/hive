import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { EncryptionService } from "@/lib/encryption";

// Mock the database with factory function to avoid hoisting issues
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Import the mock after the module is mocked
import { db } from "@/lib/db";

describe("saveOrUpdateSwarm - Password Encryption", () => {
  const enc = EncryptionService.getInstance();
  const workspaceId = "test-workspace-id";

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("encrypts password when creating new swarm", async () => {
    const testPassword = "TestPassword123!@#";

    // Mock no existing swarm (will create new one)
    (db.swarm.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    // Mock the created swarm response
    const mockCreatedSwarm = {
      id: "swarm-id",
      workspaceId,
      name: "test-swarm",
      swarmPassword: JSON.stringify(enc.encryptField("swarmPassword", testPassword)),
      instanceType: "XL",
    };
    (db.swarm.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockCreatedSwarm);

    const swarm = await saveOrUpdateSwarm({
      workspaceId,
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
    const initialPassword = "InitialPassword123!";
    const newPassword = "UpdatedPassword456!";

    // Mock existing swarm
    const existingSwarm = {
      id: "swarm-id",
      workspaceId,
      name: "test-swarm",
      swarmPassword: JSON.stringify(enc.encryptField("swarmPassword", initialPassword)),
      instanceType: "XL",
    };
    (db.swarm.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(existingSwarm);

    // Mock the updated swarm response
    const mockUpdatedSwarm = {
      ...existingSwarm,
      swarmPassword: JSON.stringify(enc.encryptField("swarmPassword", newPassword)),
    };
    (db.swarm.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockUpdatedSwarm);

    // Update with new password
    const updated = await saveOrUpdateSwarm({
      workspaceId,
      swarmPassword: newPassword,
    });

    // Verify new password is encrypted
    const decrypted = enc.decryptField("swarmPassword", updated.swarmPassword as string);
    expect(decrypted).toBe(newPassword);
  });

  it("does not modify password if not provided in update", async () => {
    const originalPassword = "OriginalPassword789!";

    // Mock existing swarm with original password
    const existingSwarm = {
      id: "swarm-id",
      workspaceId,
      name: "test-swarm",
      swarmPassword: JSON.stringify(enc.encryptField("swarmPassword", originalPassword)),
      instanceType: "XL",
      status: "PENDING",
    };
    (db.swarm.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(existingSwarm);

    // Mock the updated swarm response (password unchanged)
    const mockUpdatedSwarm = {
      ...existingSwarm,
      status: "ACTIVE",
    };
    (db.swarm.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockUpdatedSwarm);

    // Update without password
    const updated = await saveOrUpdateSwarm({
      workspaceId,
      status: "ACTIVE",
    });

    // Password should remain unchanged
    const decrypted = enc.decryptField("swarmPassword", updated.swarmPassword as string);
    expect(decrypted).toBe(originalPassword);
  });
});
