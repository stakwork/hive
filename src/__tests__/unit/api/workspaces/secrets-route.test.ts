import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import type { Mock } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/services/workspace", () => {
  const mockValidateWorkspaceAccess = vi.fn();
  return {
    validateWorkspaceAccess: mockValidateWorkspaceAccess,
    __mockValidateWorkspaceAccess: mockValidateWorkspaceAccess,
  };
});

vi.mock("@/lib/db", () => {
  const mockWorkspaceFindUnique = vi.fn();
  const mockSecretFindMany = vi.fn();
  const mockSecretCreate = vi.fn();
  return {
    db: {
      workspace: { findUnique: mockWorkspaceFindUnique },
      workspaceSecret: {
        findMany: mockSecretFindMany,
        create: mockSecretCreate,
      },
    },
    __mockWorkspaceFindUnique: mockWorkspaceFindUnique,
    __mockSecretFindMany: mockSecretFindMany,
    __mockSecretCreate: mockSecretCreate,
  };
});

vi.mock("@/lib/encryption", () => {
  const mockEncryptField = vi.fn();
  const mockDecryptField = vi.fn();
  const mockGetInstance = vi.fn(() => ({
    encryptField: mockEncryptField,
    decryptField: mockDecryptField,
  }));
  return {
    EncryptionService: { getInstance: mockGetInstance },
    __mockEncryptField: mockEncryptField,
    __mockDecryptField: mockDecryptField,
  };
});

vi.mock("@/lib/service-factory", () => {
  const mockCreateSecret = vi.fn();
  return {
    stakworkService: vi.fn(() => ({ createSecret: mockCreateSecret })),
    __mockCreateSecret: mockCreateSecret,
  };
});

// ─── Import after mocks ──────────────────────────────────────────────────────

const workspaceMock = vi.mocked(await import("@/services/workspace"));
const mockValidateWorkspaceAccess =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (workspaceMock as any).__mockValidateWorkspaceAccess as Mock;

const dbMock = vi.mocked(await import("@/lib/db"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = dbMock as any;
const mockWorkspaceFindUnique = m.__mockWorkspaceFindUnique as Mock;
const mockSecretFindMany = m.__mockSecretFindMany as Mock;
const mockSecretCreate = m.__mockSecretCreate as Mock;

const encryptionMock = vi.mocked(await import("@/lib/encryption"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const em = encryptionMock as any;
const mockEncryptField = em.__mockEncryptField as Mock;
const mockDecryptField = em.__mockDecryptField as Mock;

const serviceFactoryMock = vi.mocked(await import("@/lib/service-factory"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sm = serviceFactoryMock as any;
const mockCreateSecret = sm.__mockCreateSecret as Mock;

const mockGetServerSession = getServerSession as Mock;

const { GET, POST } = await import("@/app/api/workspaces/[slug]/secrets/route");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SLUG = "test-workspace";
const USER_ID = "user-123";
const WORKSPACE_ID = "ws-abc";

function makeRequest(method: "GET" | "POST", body?: object) {
  return new NextRequest(`http://localhost/api/workspaces/${SLUG}/secrets`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function makeParams() {
  return { params: Promise.resolve({ slug: SLUG }) };
}

function setupSession() {
  mockGetServerSession.mockResolvedValue({ user: { id: USER_ID } });
}

function setupAdminAccess(workspaceId = WORKSPACE_ID) {
  mockValidateWorkspaceAccess.mockResolvedValue({
    hasAccess: true,
    canAdmin: true,
    workspace: { id: workspaceId },
  });
}

function setupWorkspaceWithCustomer(overrides = {}) {
  mockWorkspaceFindUnique.mockResolvedValue({
    stakworkApiKey: JSON.stringify({ data: "enc", iv: "iv", tag: "tag", version: "1", encryptedAt: "now" }),
    stakworkCustomerId: "cust-1",
    ...overrides,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSession();
    setupAdminAccess();
  });

  test("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(401);
  });

  test("returns 403 when user has no admin access", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canAdmin: false,
      workspace: { id: WORKSPACE_ID },
    });
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(403);
  });

  test("returns secrets without encryptedValue", async () => {
    const secrets = [
      { id: "s-1", name: "MY_KEY", description: "desc", createdAt: new Date("2025-01-01") },
      { id: "s-2", name: "OTHER_KEY", description: null, createdAt: new Date("2025-02-01") },
    ];
    mockSecretFindMany.mockResolvedValue(secrets);

    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.secrets).toHaveLength(2);
    body.secrets.forEach((s: Record<string, unknown>) => {
      expect(s).not.toHaveProperty("encryptedValue");
    });
    expect(body.secrets[0].name).toBe("MY_KEY");
  });

  test("queries with correct workspaceId and never fetches encryptedValue", async () => {
    mockSecretFindMany.mockResolvedValue([]);

    await GET(makeRequest("GET"), makeParams());

    expect(mockSecretFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID },
        select: expect.not.objectContaining({ encryptedValue: expect.anything() }),
      })
    );
  });

  test("returns empty array when no secrets", async () => {
    mockSecretFindMany.mockResolvedValue([]);
    const res = await GET(makeRequest("GET"), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secrets).toEqual([]);
  });
});

describe("POST /api/workspaces/[slug]/secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSession();
    setupAdminAccess();
    setupWorkspaceWithCustomer();
    mockDecryptField.mockReturnValue("decrypted-token");
    mockEncryptField.mockReturnValue({ data: "enc", iv: "iv", tag: "tag", version: "1", encryptedAt: "now" });
    mockCreateSecret.mockResolvedValue({ success: true });
    mockSecretCreate.mockResolvedValue({
      id: "secret-1",
      name: "MY_SECRET",
      description: "A secret",
      createdAt: new Date("2025-01-01"),
    });
  });

  test("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(makeRequest("POST", { name: "X", value: "Y" }), makeParams());
    expect(res.status).toBe(401);
  });

  test("returns 403 when user is not admin", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canAdmin: false,
      workspace: { id: WORKSPACE_ID },
    });
    const res = await POST(makeRequest("POST", { name: "X", value: "Y" }), makeParams());
    expect(res.status).toBe(403);
  });

  test("returns 400 when name is missing", async () => {
    const res = await POST(makeRequest("POST", { value: "secret-val" }), makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name/i);
  });

  test("returns 400 when value is missing", async () => {
    const res = await POST(makeRequest("POST", { name: "MY_SECRET" }), makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/value/i);
  });

  test("returns 422 when workspace has no stakworkCustomerId", async () => {
    setupWorkspaceWithCustomer({ stakworkCustomerId: null });
    const res = await POST(makeRequest("POST", { name: "X", value: "Y" }), makeParams());
    expect(res.status).toBe(422);
    expect(mockCreateSecret).not.toHaveBeenCalled();
    expect(mockSecretCreate).not.toHaveBeenCalled();
  });

  // ── Atomic failure: Stakwork throws → NO DB row written ────────────────────
  test("does NOT create DB row if Stakwork API call throws (atomic failure)", async () => {
    mockCreateSecret.mockRejectedValue(new Error("Stakwork API error"));

    const res = await POST(
      makeRequest("POST", { name: "FAIL_SECRET", value: "val" }),
      makeParams()
    );

    expect(res.status).toBe(502);
    expect(mockSecretCreate).not.toHaveBeenCalled();
  });

  test("creates secret and returns 201 on success", async () => {
    const res = await POST(
      makeRequest("POST", { name: "MY_SECRET", value: "secret-val", description: "A secret" }),
      makeParams()
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret).toHaveProperty("id");
    expect(body.secret).toHaveProperty("name");
    expect(body.secret).not.toHaveProperty("encryptedValue");

    // Stakwork was called before DB write
    expect(mockCreateSecret).toHaveBeenCalledWith(
      "MY_SECRET",
      "secret-val",
      "decrypted-token",
      "cust-1"
    );
    expect(mockSecretCreate).toHaveBeenCalledOnce();
  });

  test("encrypts the value before DB write", async () => {
    await POST(
      makeRequest("POST", { name: "MY_SECRET", value: "plaintext" }),
      makeParams()
    );

    expect(mockEncryptField).toHaveBeenCalledWith("secretValue", "plaintext");
    // DB create receives JSON stringified encrypted value, not plaintext
    const createCall = mockSecretCreate.mock.calls[0][0];
    expect(createCall.data.encryptedValue).not.toContain("plaintext");
  });

  // ── IDOR guard: workspaceId is resolved from slug, not caller-supplied ──────
  test("IDOR guard: resolves workspaceId from slug (access check uses slug param)", async () => {
    // The route must call validateWorkspaceAccess with the URL slug, not a body-supplied ID
    await POST(
      makeRequest("POST", { name: "X", value: "Y", workspaceId: "attacker-workspace-id" }),
      makeParams()
    );

    expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(
      SLUG,
      USER_ID,
      true
    );
    // The DB create should use the resolved workspace ID, not any caller-supplied value
    if (mockSecretCreate.mock.calls.length > 0) {
      const createCall = mockSecretCreate.mock.calls[0][0];
      expect(createCall.data.workspaceId).toBe(WORKSPACE_ID);
      expect(createCall.data.workspaceId).not.toBe("attacker-workspace-id");
    }
  });

  test("IDOR guard: returns 403 when slug resolves to a different workspace than expected", async () => {
    // Simulate user trying to access a slug they don't have admin on
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: false,
      canAdmin: false,
      workspace: null,
    });

    const res = await POST(
      makeRequest("POST", { name: "X", value: "Y" }),
      makeParams()
    );

    expect(res.status).toBe(403);
    expect(mockSecretCreate).not.toHaveBeenCalled();
    expect(mockCreateSecret).not.toHaveBeenCalled();
  });
});
