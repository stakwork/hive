import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/config/env", () => ({
  env: {
    SWARM_SUPERADMIN_API_KEY: "test-super-token",
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
) {
  return new Request(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
  }) as any;
}

// ---------------------------------------------------------------------------
// GET /api/mock/swarm-super-admin/api/super/swarm_credentials
// ---------------------------------------------------------------------------

describe("GET /api/mock/swarm-super-admin/api/super/swarm_credentials", () => {
  it("returns 401 when x-super-token is missing", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/super/swarm_credentials/route"
    );

    const res = await GET(
      makeRequest("http://localhost/api/mock/swarm-super-admin/api/super/swarm_credentials?instance_id=i-001")
    );
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data).toEqual({ success: false, message: "Unauthorized" });
  });

  it("returns 401 when x-super-token is invalid", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/super/swarm_credentials/route"
    );

    const res = await GET(
      makeRequest(
        "http://localhost/api/mock/swarm-super-admin/api/super/swarm_credentials?instance_id=i-001",
        { headers: { "x-super-token": "wrong-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data).toEqual({ success: false, message: "Unauthorized" });
  });

  it("returns 400 when instance_id is missing", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/super/swarm_credentials/route"
    );

    const res = await GET(
      makeRequest(
        "http://localhost/api/mock/swarm-super-admin/api/super/swarm_credentials",
        { headers: { "x-super-token": "test-super-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data).toEqual({ success: false, message: "instance_id required" });
  });

  it("returns 200 with correct shape on valid request", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/super/swarm_credentials/route"
    );

    const res = await GET(
      makeRequest(
        "http://localhost/api/mock/swarm-super-admin/api/super/swarm_credentials?instance_id=i-mock0000000001",
        { headers: { "x-super-token": "test-super-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: "Swarm credentials",
      data: { username: "super", password: "mock-password" },
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/mock/swarm-super-admin/api/cmd
// ---------------------------------------------------------------------------

describe("GET /api/mock/swarm-super-admin/api/cmd", () => {
  it("returns 401 when x-jwt header is missing", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/route"
    );

    const res = await GET(
      makeRequest("http://localhost/api/mock/swarm-super-admin/api/cmd?txt=%7B%22cmd%22%3A%22ListContainers%22%7D")
    );
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data).toMatchObject({ error: "Unauthorized" });
  });

  it("returns container array for ListContainers", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/route"
    );

    const txt = encodeURIComponent(JSON.stringify({ cmd: "ListContainers" }));
    const res = await GET(
      makeRequest(
        `http://localhost/api/mock/swarm-super-admin/api/cmd?txt=${txt}`,
        { headers: { "x-jwt": "mock-jwt-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      containers: expect.arrayContaining([
        expect.objectContaining({ name: "sphinx", status: "running" }),
        expect.objectContaining({ name: "lnd", status: "stopped" }),
      ]),
    });
    expect(data.containers).toHaveLength(3);
  });

  it("returns { success: true } for StartContainer", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/route"
    );

    const txt = encodeURIComponent(JSON.stringify({ cmd: "StartContainer", content: "lnd" }));
    const res = await GET(
      makeRequest(
        `http://localhost/api/mock/swarm-super-admin/api/cmd?txt=${txt}`,
        { headers: { "x-jwt": "mock-jwt-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true });
  });

  it("returns { success: true } for StopContainer", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/route"
    );

    const txt = encodeURIComponent(JSON.stringify({ cmd: "StopContainer", content: "sphinx" }));
    const res = await GET(
      makeRequest(
        `http://localhost/api/mock/swarm-super-admin/api/cmd?txt=${txt}`,
        { headers: { "x-jwt": "mock-jwt-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true });
  });

  it("returns { success: true } for RestartContainer", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/route"
    );

    const txt = encodeURIComponent(JSON.stringify({ cmd: "RestartContainer", content: "neo4j" }));
    const res = await GET(
      makeRequest(
        `http://localhost/api/mock/swarm-super-admin/api/cmd?txt=${txt}`,
        { headers: { "x-jwt": "mock-jwt-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true });
  });

  it("returns logs for GetContainerLogs", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/route"
    );

    const txt = encodeURIComponent(JSON.stringify({ cmd: "GetContainerLogs", content: "sphinx" }));
    const res = await GET(
      makeRequest(
        `http://localhost/api/mock/swarm-super-admin/api/cmd?txt=${txt}`,
        { headers: { "x-jwt": "mock-jwt-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ logs: expect.stringContaining("[mock]") });
  });

  it("returns 400 for unknown cmd", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/route"
    );

    const txt = encodeURIComponent(JSON.stringify({ cmd: "DoSomethingWeird" }));
    const res = await GET(
      makeRequest(
        `http://localhost/api/mock/swarm-super-admin/api/cmd?txt=${txt}`,
        { headers: { "x-jwt": "mock-jwt-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data).toMatchObject({ error: expect.stringContaining("Unknown cmd") });
  });

  it("returns 400 when txt param is missing", async () => {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/route"
    );

    const res = await GET(
      makeRequest(
        "http://localhost/api/mock/swarm-super-admin/api/cmd",
        { headers: { "x-jwt": "mock-jwt-token" } }
      )
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data).toMatchObject({ error: expect.stringContaining("Missing txt") });
  });
});

// ---------------------------------------------------------------------------
// Boltwall stateful commands
// ---------------------------------------------------------------------------

describe("Boltwall stateful mock commands", () => {
  // Reset state before each test to ensure isolation
  beforeEach(async () => {
    const { resetMockBoltwallState } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/state"
    );
    resetMockBoltwallState();
  });

  async function cmdRequest(cmd: object) {
    const { GET } = await import(
      "@/app/api/mock/swarm-super-admin/api/cmd/route"
    );
    const txt = encodeURIComponent(JSON.stringify(cmd));
    return GET(
      makeRequest(
        `http://localhost/api/mock/swarm-super-admin/api/cmd?txt=${txt}`,
        { headers: { "x-jwt": "mock-jwt-token" } }
      )
    );
  }

  it("GetBoltwallAccessibility returns { isPublic: false } by default", async () => {
    const res = await cmdRequest({ cmd: "GetBoltwallAccessibility" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({ isPublic: false });
  });

  it("UpdateBoltwallAccessibility + GetBoltwallAccessibility round-trip", async () => {
    // Set to true
    const updateRes = await cmdRequest({
      type: "Swarm",
      data: { cmd: "UpdateBoltwallAccessibility", content: true },
    });
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toEqual({ success: true });

    // Confirm state persisted
    const getRes = await cmdRequest({ cmd: "GetBoltwallAccessibility" });
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ isPublic: true });
  });

  it("ListPaidEndpoint returns 2 endpoints by default", async () => {
    const res = await cmdRequest({ cmd: "ListPaidEndpoint" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.endpoints).toHaveLength(2);
    expect(data.endpoints[0]).toMatchObject({ id: 1, route: "v2/search" });
    expect(data.endpoints[1]).toMatchObject({ id: 2, route: "node/content" });
  });

  it("UpdatePaidEndpoint mutates endpoint status", async () => {
    // Disable endpoint id=1
    const updateRes = await cmdRequest({
      type: "Swarm",
      data: { cmd: "UpdatePaidEndpoint", content: { id: 1, status: false } },
    });
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toEqual({ success: true });

    // Re-fetch and confirm
    const listRes = await cmdRequest({ cmd: "ListPaidEndpoint" });
    const data = await listRes.json();
    const ep1 = data.endpoints.find((e: { id: number }) => e.id === 1);
    expect(ep1.status).toBe(false);
    // Other endpoint unchanged
    const ep2 = data.endpoints.find((e: { id: number }) => e.id === 2);
    expect(ep2.status).toBe(true);
  });

  it("GetBoltwallSuperAdmin returns { pubkey: null, name: null }", async () => {
    const res = await cmdRequest({ cmd: "GetBoltwallSuperAdmin" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({ pubkey: null, name: null });
  });

  it("GetBotBalance returns { balance: 0 }", async () => {
    const res = await cmdRequest({ cmd: "GetBotBalance" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({ balance: 0 });
  });

  it("CreateBotInvoice returns an invoice string", async () => {
    const res = await cmdRequest({
      type: "Swarm",
      data: { cmd: "CreateBotInvoice", content: { amt_msat: 1000 } },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(typeof data.invoice).toBe("string");
  });

  it("state resets between tests (isPublic is false again)", async () => {
    const res = await cmdRequest({ cmd: "GetBoltwallAccessibility" });
    const data = await res.json();
    expect(data).toEqual({ isPublic: false });
  });
});
