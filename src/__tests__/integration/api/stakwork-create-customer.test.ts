import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/create-customer/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";

// Mock stakwork service factory to capture calls
const mockCreateCustomer = vi.fn(async () => ({
  data: { token: "stak-token" },
}));
const mockCreateSecret = vi.fn(async () => ({ data: {} }));

vi.mock("@/lib/service-factory", () => ({
  stakworkService: () => ({
    createCustomer: mockCreateCustomer,
    createSecret: mockCreateSecret,
  }),
}));

describe("POST /api/stakwork/create-customer", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_plain_key_123";
  let workspaceId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "User 1",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "w1",
          slug: generateUniqueSlug("w1"),
          ownerId: user.id,
        },
      });

      await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "s1-name",
          status: "ACTIVE",
          swarmId: generateUniqueId("s1"),
          swarmUrl: "https://s1-name.sphinx.chat/api",
          swarmSecretAlias: "{{SWARM_123456_API_KEY}}",
          swarmApiKey: JSON.stringify(
            enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY),
          ),
          services: [],
        },
      });

      return { user, workspace };
    });

    workspaceId = testData.workspace.id;

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testData.user));
  });

  it("creates secret with plaintext value (not encrypted JSON)", async () => {
    const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

    const res = await POST(req);
    expect(res?.status).toBe(201);

    expect(mockCreateCustomer).toHaveBeenCalledOnce();
    expect(mockCreateSecret).toHaveBeenCalledOnce();

    const args = mockCreateSecret.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(args[0]).toBe("SWARM_123456_API_KEY");
    expect(args[1]).toBe(PLAINTEXT_SWARM_API_KEY); // plaintext sent
    expect(args[2]).toBe("stak-token");
  });

  it("double-encrypted rows are decrypted back to plaintext before sending", async () => {
    // Make swarm row contain double-encrypted content to simulate legacy bug
    const first = enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY);
    const doubleCipher = enc.encryptField("swarmApiKey", JSON.stringify(first));
    await db.swarm.updateMany({
      where: { workspaceId },
      data: { swarmApiKey: JSON.stringify(doubleCipher) },
    });

    const req = createPostRequest("http://localhost:3000/api/stakwork/create-customer", { workspaceId });

    mockCreateSecret.mockClear();
    const res = await POST(req);
    expect(res?.status).toBe(201);

    const args = mockCreateSecret.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(args[1]).toBe(PLAINTEXT_SWARM_API_KEY);
  });
});
