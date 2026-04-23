import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock db before importing
const mockSwarmUpdate = vi.fn();
const mockWorkspaceUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    swarm: { update: mockSwarmUpdate },
    workspace: { update: mockWorkspaceUpdate },
    $transaction: mockTransaction,
  },
}));

const mockDecryptField = vi.fn((_, v: string) => `decrypted-${v}`);
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: mockDecryptField,
    })),
  },
  encryptEnvVars: vi.fn(),
}));

const mockSetGraphTitle = vi.fn();
vi.mock("@/services/swarm/graph-title", () => ({
  setGraphTitle: mockSetGraphTitle,
}));

// Stub PodState/PoolState/SwarmStatus from prisma
vi.mock("@prisma/client", () => ({
  PodState: {},
  PoolState: {},
  SwarmStatus: {},
}));

const { updateSwarmVanityAddress } = await import("@/services/swarm/db");

describe("updateSwarmVanityAddress", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: transaction executes the array of operations
    mockTransaction.mockImplementation(async (ops: unknown[]) => {
      for (const op of ops) {
        await op;
      }
    });
    mockSwarmUpdate.mockResolvedValue({});
    mockWorkspaceUpdate.mockResolvedValue({});
    mockSetGraphTitle.mockResolvedValue(undefined);
  });

  test("calls db.$transaction with swarm.update and workspace.update", async () => {
    await updateSwarmVanityAddress({
      workspaceId: "ws-123",
      newSubdomain: "myswarm",
    });

    expect(mockTransaction).toHaveBeenCalledOnce();

    // The transaction receives an array of two promises
    const [ops] = mockTransaction.mock.calls[0];
    expect(ops).toHaveLength(2);
  });

  test("updates swarm with correct name and swarmUrl", async () => {
    await updateSwarmVanityAddress({
      workspaceId: "ws-123",
      newSubdomain: "myswarm",
    });

    expect(mockSwarmUpdate).toHaveBeenCalledWith({
      where: { workspaceId: "ws-123" },
      data: {
        name: "myswarm",
        swarmUrl: "https://myswarm.sphinx.chat/api",
      },
    });
  });

  test("updates workspace with correct slug and name", async () => {
    await updateSwarmVanityAddress({
      workspaceId: "ws-123",
      newSubdomain: "myswarm",
    });

    expect(mockWorkspaceUpdate).toHaveBeenCalledWith({
      where: { id: "ws-123" },
      data: {
        slug: "myswarm",
        name: "myswarm",
        updatedAt: expect.any(Date),
      },
    });
  });

  test("does NOT call setGraphTitle when swarmPassword is not provided", async () => {
    await updateSwarmVanityAddress({
      workspaceId: "ws-123",
      newSubdomain: "myswarm",
    });

    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetGraphTitle).not.toHaveBeenCalled();
  });

  test("does NOT call setGraphTitle when swarmPassword is null", async () => {
    await updateSwarmVanityAddress({
      workspaceId: "ws-123",
      newSubdomain: "myswarm",
      swarmPassword: null,
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetGraphTitle).not.toHaveBeenCalled();
  });

  test("calls setGraphTitle fire-and-forget when swarmPassword is provided", async () => {
    mockSetGraphTitle.mockResolvedValue(undefined);

    await updateSwarmVanityAddress({
      workspaceId: "ws-123",
      newSubdomain: "myswarm",
      swarmPassword: "encrypted-pw",
    });

    // Allow the fire-and-forget promise to resolve
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetGraphTitle).toHaveBeenCalledOnce();
    expect(mockSetGraphTitle).toHaveBeenCalledWith(
      "https://myswarm.sphinx.chat/api",
      "decrypted-encrypted-pw",
      "myswarm"
    );
  });

  test("decrypts swarmPassword before calling setGraphTitle", async () => {
    await updateSwarmVanityAddress({
      workspaceId: "ws-123",
      newSubdomain: "myswarm",
      swarmPassword: "some-encrypted-value",
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(mockDecryptField).toHaveBeenCalledWith("swarmPassword", "some-encrypted-value");
  });

  test("setGraphTitle errors do not throw (fire-and-forget)", async () => {
    mockSetGraphTitle.mockRejectedValue(new Error("title service down"));

    // Should not throw
    await expect(
      updateSwarmVanityAddress({
        workspaceId: "ws-123",
        newSubdomain: "myswarm",
        swarmPassword: "encrypted-pw",
      })
    ).resolves.toBeUndefined();

    // Allow rejection to be handled internally
    await new Promise((r) => setTimeout(r, 10));
  });

  test("propagates transaction errors", async () => {
    mockTransaction.mockRejectedValue(new Error("DB transaction failed"));

    await expect(
      updateSwarmVanityAddress({
        workspaceId: "ws-123",
        newSubdomain: "myswarm",
      })
    ).rejects.toThrow("DB transaction failed");
  });
});
