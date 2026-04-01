import { describe, it, expect, vi } from "vitest";

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
