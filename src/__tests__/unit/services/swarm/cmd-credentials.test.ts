import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — DB; encryption is part-real (envelope shape), decrypt is mocked.
// ---------------------------------------------------------------------------

const mockFindMany = vi.hoisted(() => vi.fn());
const mockDecryptField = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: { swarm: { findMany: mockFindMany } },
}));

vi.mock("@/lib/encryption", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encryption")>();
  return {
    ...actual,
    EncryptionService: { getInstance: () => ({ decryptField: mockDecryptField }) },
  };
});

const { resolveDbSwarmCredentials } = await import("@/services/swarm/cmd-credentials");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envelopeJson(): string {
  return JSON.stringify({
    data: "ZW5jcnlwdGVkLXB3",
    iv: "MDEyMzQ1Njc4OWFiY2RlZg==",
    tag: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    keyId: "default",
    version: "1",
    encryptedAt: new Date().toISOString(),
  });
}

function swarmRow(overrides: Record<string, unknown> = {}) {
  return {
    swarmUrl: "https://swarm40.sphinx.chat",
    swarmPassword: envelopeJson(),
    workspace: { deleted: false },
    ...overrides,
  };
}

const INSTANCE_ID = "i-0abc123def456789";

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

describe("resolveDbSwarmCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDecryptField.mockReturnValue("decrypted-plain-pw");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("zero matching rows returns null", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await resolveDbSwarmCredentials(INSTANCE_ID);

    expect(result).toBeNull();
    expect(mockDecryptField).not.toHaveBeenCalled();
  });

  test("more than one matching row returns null (ambiguous — never an arbitrary pick)", async () => {
    mockFindMany.mockResolvedValue([swarmRow(), swarmRow()]);

    const result = await resolveDbSwarmCredentials(INSTANCE_ID);

    expect(result).toBeNull();
    expect(mockDecryptField).not.toHaveBeenCalled();
  });

  test("a soft-deleted owning workspace returns null without decrypting", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ workspace: { deleted: true } })]);

    const result = await resolveDbSwarmCredentials(INSTANCE_ID);

    expect(result).toBeNull();
    expect(mockDecryptField).not.toHaveBeenCalled();
  });

  test("missing swarmUrl returns null without decrypting", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmUrl: null })]);

    const result = await resolveDbSwarmCredentials(INSTANCE_ID);

    expect(result).toBeNull();
    expect(mockDecryptField).not.toHaveBeenCalled();
  });

  test("missing swarmPassword returns null without decrypting", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmPassword: null })]);

    const result = await resolveDbSwarmCredentials(INSTANCE_ID);

    expect(result).toBeNull();
    expect(mockDecryptField).not.toHaveBeenCalled();
  });

  test("a stored password that is not an encrypted envelope returns null without decrypting", async () => {
    mockFindMany.mockResolvedValue([swarmRow({ swarmPassword: "plaintext-password" })]);

    const result = await resolveDbSwarmCredentials(INSTANCE_ID);

    expect(result).toBeNull();
    expect(mockDecryptField).not.toHaveBeenCalled();
  });

  test("a decrypt failure returns null", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);
    mockDecryptField.mockImplementation(() => {
      throw new Error("Decryption failed");
    });

    const result = await resolveDbSwarmCredentials(INSTANCE_ID);

    expect(result).toBeNull();
  });

  test("happy path returns { swarmUrl, username: 'admin', password } from the DB row", async () => {
    const envelope = envelopeJson();
    mockFindMany.mockResolvedValue([
      swarmRow({ swarmUrl: "https://swarm42.sphinx.chat", swarmPassword: envelope }),
    ]);

    const result = await resolveDbSwarmCredentials(INSTANCE_ID);

    expect(result).toEqual({
      swarmUrl: "https://swarm42.sphinx.chat",
      username: "admin",
      password: "decrypted-plain-pw",
    });
    expect(mockDecryptField).toHaveBeenCalledWith("swarmPassword", envelope);
  });

  test("queries by ec2Id with the expected select shape", async () => {
    mockFindMany.mockResolvedValue([swarmRow()]);

    await resolveDbSwarmCredentials(INSTANCE_ID);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { ec2Id: INSTANCE_ID },
      select: {
        swarmUrl: true,
        swarmPassword: true,
        workspace: { select: { deleted: true } },
      },
    });
  });
});
