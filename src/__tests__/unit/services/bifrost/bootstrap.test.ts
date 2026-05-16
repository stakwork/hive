import { describe, it, expect, vi, beforeEach } from "vitest";

import { bootstrapAdminCreds } from "@/services/bifrost/bootstrap";
import { BifrostConfigError } from "@/services/bifrost/resolve";
import { dbMock } from "@/__tests__/support/mocks/prisma";

// Minimal encryption round-trip: encrypt wraps the value in an
// envelope, decrypt unwraps it. Matches the shape produced by
// services/swarm/db.ts and consumed by resolve.ts.
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((_field: string, value: string) => ({
        data: value,
        iv: "iv",
        tag: "tag",
        version: "1",
        encryptedAt: "2026-01-01T00:00:00Z",
      })),
      decryptField: vi.fn((_field: string, input: unknown) => {
        let payload: { data?: unknown } | null = null;
        if (typeof input === "string") {
          try {
            payload = JSON.parse(input);
          } catch {
            throw new Error("Invalid encrypted data");
          }
        } else if (input && typeof input === "object") {
          payload = input as { data?: unknown };
        }
        if (!payload || typeof payload.data !== "string") {
          throw new Error("Invalid encrypted data format");
        }
        return payload.data;
      }),
    })),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const WORKSPACE_ID = "ws-1";
const SWARM_ID = "swarm-1";
const SWARM_URL = "https://swarm-abc.sphinx.chat/api";
// Encrypted swarmApiKey envelope: the encryption-mock above unwraps
// .data as plaintext, so this resolves to the provisioning token.
const ENCRYPTED_PROVISIONING_TOKEN = JSON.stringify({
  data: "stakwork-secret-xyz",
  iv: "iv",
  tag: "tag",
  version: "1",
  encryptedAt: "2026-01-01T00:00:00Z",
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe("bootstrapAdminCreds", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValue({
      id: SWARM_ID,
      swarmUrl: SWARM_URL,
      swarmApiKey: ENCRYPTED_PROVISIONING_TOKEN,
    });
    vi.mocked(dbMock.swarm.update).mockResolvedValue({});
  });

  it("fetches /_plugin/admin-credentials with Bearer + caches creds", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        admin_username: "admin",
        admin_password: "pw-from-gateway",
      }),
    );

    const result = await bootstrapAdminCreds(WORKSPACE_ID, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toEqual({
      baseUrl: "https://swarm-abc.sphinx.chat:8181",
      adminUser: "admin",
      adminPassword: "pw-from-gateway",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://swarm-abc.sphinx.chat:8181/_plugin/admin-credentials",
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer stakwork-secret-xyz");
    expect((init as RequestInit).method).toBe("GET");

    // Persist call: bifrostAdminUser plaintext, bifrostAdminPassword
    // encrypted as a stringified envelope whose .data matches the pw.
    expect(dbMock.swarm.update).toHaveBeenCalledTimes(1);
    const updateArgs = vi.mocked(dbMock.swarm.update).mock.calls[0][0];
    expect(updateArgs.where).toEqual({ workspaceId: WORKSPACE_ID });
    expect(updateArgs.data.bifrostAdminUser).toBe("admin");
    const encryptedBlob = JSON.parse(updateArgs.data.bifrostAdminPassword);
    expect(encryptedBlob.data).toBe("pw-from-gateway");
  });

  it("throws BifrostConfigError when swarm row is missing", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce(null);

    await expect(
      bootstrapAdminCreds(WORKSPACE_ID, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(BifrostConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when swarmUrl is missing", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      id: SWARM_ID,
      swarmUrl: null,
      swarmApiKey: ENCRYPTED_PROVISIONING_TOKEN,
    });

    await expect(
      bootstrapAdminCreds(WORKSPACE_ID, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/has no swarmUrl/);
  });

  it("throws when swarmApiKey is missing (no provisioning token)", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      id: SWARM_ID,
      swarmUrl: SWARM_URL,
      swarmApiKey: null,
    });

    await expect(
      bootstrapAdminCreds(WORKSPACE_ID, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/has no swarmApiKey/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 401 from the gateway as BifrostConfigError", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(401, "unauthorized"));

    await expect(
      bootstrapAdminCreds(WORKSPACE_ID, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/returned 401/);
    expect(dbMock.swarm.update).not.toHaveBeenCalled();
  });

  it("surfaces a 503 (plugin server not running) as BifrostConfigError", async () => {
    // Wrapper returns 503 when /_plugin/* is configured but the plugin
    // server didn't start — happens if BIFROST_PROVISIONING_TOKEN was
    // missing at boot.
    fetchMock.mockResolvedValueOnce(
      textResponse(503, "plugin server is not running"),
    );

    await expect(
      bootstrapAdminCreds(WORKSPACE_ID, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/returned 503/);
  });

  it("rejects an unexpected payload shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { whatever: 1 }));

    await expect(
      bootstrapAdminCreds(WORKSPACE_ID, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/unexpected payload shape/);
    expect(dbMock.swarm.update).not.toHaveBeenCalled();
  });

  it("treats an empty admin_password as invalid", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { admin_username: "admin", admin_password: "" }),
    );

    await expect(
      bootstrapAdminCreds(WORKSPACE_ID, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/unexpected payload shape/);
  });

  it("propagates network errors as BifrostConfigError", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      bootstrapAdminCreds(WORKSPACE_ID, {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/fetch failed: ECONNREFUSED/);
  });

  it("is idempotent: calling twice updates with the same values", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          admin_username: "admin",
          admin_password: "pw-from-gateway",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          admin_username: "admin",
          admin_password: "pw-from-gateway",
        }),
      );

    const r1 = await bootstrapAdminCreds(WORKSPACE_ID, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r2 = await bootstrapAdminCreds(WORKSPACE_ID, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(r1).toEqual(r2);
    expect(dbMock.swarm.update).toHaveBeenCalledTimes(2);
  });
});
