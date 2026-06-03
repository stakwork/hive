import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  resolveBifrost,
  BifrostConfigError,
} from "@/services/bifrost/resolve";
import { dbMock } from "@/__tests__/support/mocks/prisma";

// Match the encryption shape from BifrostClient.test.ts /
// reconciler.test.ts so tests are uniform.
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

// resolveBifrost lazy-imports bootstrap.ts; stub the module so we
// don't pull the real fetch flow into resolve unit tests.
const bootstrapMock = vi.fn();
vi.mock("@/services/bifrost/bootstrap", () => ({
  bootstrapAdminCreds: (...args: unknown[]) => bootstrapMock(...args),
}));

const WORKSPACE_ID = "ws-1";
const SWARM_URL = "https://swarm-abc.sphinx.chat/api";

function encrypted(value: string): string {
  return JSON.stringify({
    data: value,
    iv: "iv",
    tag: "tag",
    version: "1",
    encryptedAt: "2026-01-01T00:00:00Z",
  });
}

describe("resolveBifrost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns decrypted creds when both fields are present (no bootstrap)", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      swarmUrl: SWARM_URL,
      bifrostAdminUser: "admin",
      bifrostAdminPassword: encrypted("cached-pw"),
    });

    const result = await resolveBifrost(WORKSPACE_ID);
    expect(result).toEqual({
      baseUrl: "https://swarm-abc.sphinx.chat:8181",
      adminUser: "admin",
      adminPassword: "cached-pw",
    });
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it("lazy-bootstraps when bifrostAdminUser is missing", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      swarmUrl: SWARM_URL,
      bifrostAdminUser: null,
      bifrostAdminPassword: null,
    });
    bootstrapMock.mockResolvedValueOnce({
      baseUrl: "https://swarm-abc.sphinx.chat:8181",
      adminUser: "admin",
      adminPassword: "freshly-bootstrapped",
    });

    const result = await resolveBifrost(WORKSPACE_ID);
    expect(result.adminPassword).toBe("freshly-bootstrapped");
    expect(bootstrapMock).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("lazy-bootstraps when only the password is missing", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      swarmUrl: SWARM_URL,
      bifrostAdminUser: "admin",
      bifrostAdminPassword: null,
    });
    bootstrapMock.mockResolvedValueOnce({
      baseUrl: "https://swarm-abc.sphinx.chat:8181",
      adminUser: "admin",
      adminPassword: "fresh",
    });

    await resolveBifrost(WORKSPACE_ID);
    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });

  it("throws BifrostConfigError when no swarm row exists", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce(null);

    await expect(resolveBifrost(WORKSPACE_ID)).rejects.toBeInstanceOf(
      BifrostConfigError,
    );
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it("throws BifrostConfigError when swarmUrl is missing", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      swarmUrl: null,
      bifrostAdminUser: "admin",
      bifrostAdminPassword: encrypted("pw"),
    });

    await expect(resolveBifrost(WORKSPACE_ID)).rejects.toThrow(
      /has no swarmUrl/,
    );
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it("propagates bootstrap errors", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      swarmUrl: SWARM_URL,
      bifrostAdminUser: null,
      bifrostAdminPassword: null,
    });
    bootstrapMock.mockRejectedValueOnce(
      new BifrostConfigError("plugin unreachable"),
    );

    await expect(resolveBifrost(WORKSPACE_ID)).rejects.toThrow(
      /plugin unreachable/,
    );
  });

  it("surfaces a decrypt failure as BifrostConfigError", async () => {
    vi.mocked(dbMock.swarm.findUnique).mockResolvedValueOnce({
      swarmUrl: SWARM_URL,
      bifrostAdminUser: "admin",
      bifrostAdminPassword: "garbage-not-json",
    });

    await expect(resolveBifrost(WORKSPACE_ID)).rejects.toThrow(
      /Failed to decrypt/,
    );
    expect(bootstrapMock).not.toHaveBeenCalled();
  });
});
