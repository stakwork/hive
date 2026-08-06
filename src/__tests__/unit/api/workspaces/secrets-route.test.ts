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

vi.mock("@/lib/middleware/utils", () => {
  const mockCheckIsSuperAdmin = vi.fn();
  return {
    checkIsSuperAdmin: mockCheckIsSuperAdmin,
    __mockCheckIsSuperAdmin: mockCheckIsSuperAdmin,
  };
});

vi.mock("@/lib/logger", () => {
  const mockWarn = vi.fn();
  return {
    logger: { warn: mockWarn },
    __mockLoggerWarn: mockWarn,
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

const utilsMock = vi.mocked(await import("@/lib/middleware/utils"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCheckIsSuperAdmin = (utilsMock as any).__mockCheckIsSuperAdmin as Mock;

const loggerMock = vi.mocked(await import("@/lib/logger"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockLoggerWarn = (loggerMock as any).__mockLoggerWarn as Mock;

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

// ─── Super-admin bypass tests ─────────────────────────────────────────────────

const DENIED_ACCESS = { hasAccess: false, canAdmin: false, workspace: null };
const OWNER_ACCESS = { hasAccess: true, canAdmin: true, workspace: { id: WORKSPACE_ID } };

describe("GET /api/workspaces/[slug]/secrets — super-admin bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSession();
    mockSecretFindMany.mockResolvedValue([]);
  });

  test("non-member super admin: returns 200 and lists secrets", async () => {
    // First access check denies; super-admin check elevates.
    mockValidateWorkspaceAccess
      .mockResolvedValueOnce(DENIED_ACCESS)
      .mockResolvedValueOnce(OWNER_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(true);

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("secrets");
  });

  test("non-member super admin: validateWorkspaceAccess retried with { isSuperAdmin: true } on the elevate path", async () => {
    mockValidateWorkspaceAccess
      .mockResolvedValueOnce(DENIED_ACCESS)
      .mockResolvedValueOnce(OWNER_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(true);

    await GET(makeRequest("GET"), makeParams());

    expect(mockValidateWorkspaceAccess).toHaveBeenCalledTimes(2);
    expect(mockValidateWorkspaceAccess).toHaveBeenNthCalledWith(1, SLUG, USER_ID, true);
    expect(mockValidateWorkspaceAccess).toHaveBeenNthCalledWith(2, SLUG, USER_ID, true, { isSuperAdmin: true });
  });

  test("checkIsSuperAdmin only called when first access check fails", async () => {
    // First call grants access directly — hot path.
    mockValidateWorkspaceAccess.mockResolvedValueOnce(OWNER_ACCESS);

    await GET(makeRequest("GET"), makeParams());

    expect(mockCheckIsSuperAdmin).not.toHaveBeenCalled();
  });

  test("non-member non-super-admin: still returns 403", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue(DENIED_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(false);

    const res = await GET(makeRequest("GET"), makeParams());

    expect(res.status).toBe(403);
    // checkIsSuperAdmin was called but bypass not granted.
    expect(mockCheckIsSuperAdmin).toHaveBeenCalledOnce();
  });

  test("no audit log on GET even for super-admin bypass", async () => {
    mockValidateWorkspaceAccess
      .mockResolvedValueOnce(DENIED_ACCESS)
      .mockResolvedValueOnce(OWNER_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(true);

    await GET(makeRequest("GET"), makeParams());

    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});

describe("POST /api/workspaces/[slug]/secrets — super-admin bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSession();
    setupWorkspaceWithCustomer();
    mockDecryptField.mockReturnValue("decrypted-token");
    mockEncryptField.mockReturnValue({ data: "enc", iv: "iv", tag: "tag", version: "1", encryptedAt: "now" });
    mockCreateSecret.mockResolvedValue({ success: true });
    mockSecretCreate.mockResolvedValue({
      id: "secret-1",
      name: "MY_SECRET",
      description: null,
      createdAt: new Date("2025-01-01"),
    });
  });

  test("non-member super admin: returns 201 and creates secret", async () => {
    mockValidateWorkspaceAccess
      .mockResolvedValueOnce(DENIED_ACCESS)
      .mockResolvedValueOnce(OWNER_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(true);

    const res = await POST(
      makeRequest("POST", { name: "SA_SECRET", value: "val" }),
      makeParams()
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret).toHaveProperty("id");
  });

  test("non-member super admin: validateWorkspaceAccess retried with { isSuperAdmin: true }", async () => {
    mockValidateWorkspaceAccess
      .mockResolvedValueOnce(DENIED_ACCESS)
      .mockResolvedValueOnce(OWNER_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(true);

    await POST(
      makeRequest("POST", { name: "SA_SECRET", value: "val" }),
      makeParams()
    );

    expect(mockValidateWorkspaceAccess).toHaveBeenCalledTimes(2);
    expect(mockValidateWorkspaceAccess).toHaveBeenNthCalledWith(1, SLUG, USER_ID, true);
    expect(mockValidateWorkspaceAccess).toHaveBeenNthCalledWith(2, SLUG, USER_ID, true, { isSuperAdmin: true });
  });

  test("non-member super admin POST: emits audit log entry BEFORE write sequence", async () => {
    mockValidateWorkspaceAccess
      .mockResolvedValueOnce(DENIED_ACCESS)
      .mockResolvedValueOnce(OWNER_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(true);

    await POST(
      makeRequest("POST", { name: "SA_SECRET", value: "val" }),
      makeParams()
    );

    // Audit log must have fired.
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    const [message, , meta] = mockLoggerWarn.mock.calls[0];
    expect(message).toContain("AUDIT");
    expect(meta).toMatchObject({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      slug: SLUG,
      action: "secrets.create",
      superAdminBypass: true,
    });

    // Audit log must fire before the Stakwork call.
    const auditCallOrder = mockLoggerWarn.mock.invocationCallOrder[0];
    const stakworkCallOrder = mockCreateSecret.mock.invocationCallOrder[0];
    expect(auditCallOrder).toBeLessThan(stakworkCallOrder);
  });

  test("normal admin POST: NO audit log emitted", async () => {
    // Direct access granted on first check — normal path.
    mockValidateWorkspaceAccess.mockResolvedValueOnce(OWNER_ACCESS);

    await POST(
      makeRequest("POST", { name: "NORMAL_SECRET", value: "val" }),
      makeParams()
    );

    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  test("non-member non-super-admin: still returns 403 and no write occurs", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue(DENIED_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(false);

    const res = await POST(
      makeRequest("POST", { name: "X", value: "Y" }),
      makeParams()
    );

    expect(res.status).toBe(403);
    expect(mockCheckIsSuperAdmin).toHaveBeenCalledOnce();
    expect(mockSecretCreate).not.toHaveBeenCalled();
    expect(mockCreateSecret).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  test("IDOR: workspaceId always comes from validated access, not caller-supplied value", async () => {
    mockValidateWorkspaceAccess
      .mockResolvedValueOnce(DENIED_ACCESS)
      .mockResolvedValueOnce(OWNER_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(true);

    await POST(
      makeRequest("POST", { name: "X", value: "Y", workspaceId: "attacker-id" }),
      makeParams()
    );

    if (mockSecretCreate.mock.calls.length > 0) {
      expect(mockSecretCreate.mock.calls[0][0].data.workspaceId).toBe(WORKSPACE_ID);
      expect(mockSecretCreate.mock.calls[0][0].data.workspaceId).not.toBe("attacker-id");
    }
  });

  test("no secret values appear in the audit log entry", async () => {
    mockValidateWorkspaceAccess
      .mockResolvedValueOnce(DENIED_ACCESS)
      .mockResolvedValueOnce(OWNER_ACCESS);
    mockCheckIsSuperAdmin.mockResolvedValueOnce(true);

    await POST(
      makeRequest("POST", { name: "SA_SECRET", value: "super-secret-plaintext" }),
      makeParams()
    );

    const logArgs = JSON.stringify(mockLoggerWarn.mock.calls);
    expect(logArgs).not.toContain("super-secret-plaintext");
  });
});
