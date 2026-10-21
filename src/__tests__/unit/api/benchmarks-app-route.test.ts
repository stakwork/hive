/**
 * GET /api/workspaces/:slug/benchmarks/:benchmarkSlug/app — where a
 * benchmark's strut app is: the workspace's org and its own swarm, for an
 * entry that names an app (`Benchmark.app`); 404 for one that does not.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { Benchmark } from "@/lib/benchmarks/registry";

vi.mock("@/lib/db", () => ({ db: { workspace: { findUnique: vi.fn() } } }));
vi.mock("@/lib/benchmarks/access", () => ({ authorizeBenchmark: vi.fn() }));

const { db } = await import("@/lib/db");
const { authorizeBenchmark } = await import("@/lib/benchmarks/access");
const { GET } = await import("@/app/api/workspaces/[slug]/benchmarks/[benchmarkSlug]/app/route");

const mockAuthorize = authorizeBenchmark as Mock;
const mockWorkspace = db.workspace.findUnique as Mock;

const WITH_APP: Benchmark = { slug: "bench", name: "Bench", runWorkflow: "wfbench-run", app: { name: "bench" } };
const PINNED: Benchmark = { ...WITH_APP, app: { name: "bench", version: "v2" } };
const WITHOUT: Benchmark = { slug: "plain", name: "Plain", runWorkflow: "plain-run" };

const member = { kind: "member", userId: "user-1", workspaceId: "ws-1", slug: "acme", role: "DEVELOPER" };
const request = () => new NextRequest("http://localhost/api/workspaces/acme/benchmarks/bench/app");
const params = (benchmarkSlug: string) => ({ params: Promise.resolve({ slug: "acme", benchmarkSlug }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspace.mockResolvedValue({ swarm: { id: "swarm-1" }, sourceControlOrg: { githubLogin: "acme-org" } });
});

describe("GET …/benchmarks/:benchmarkSlug/app", () => {
  it("an entry with an app: the org, the workspace's own swarm and the app", async () => {
    mockAuthorize.mockResolvedValue({ member, benchmark: WITH_APP });
    const res = await GET(request(), params("bench"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ githubLogin: "acme-org", swarmId: "swarm-1", app: { name: "bench" } });
    expect(mockWorkspace).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ws-1" } }));

    mockAuthorize.mockResolvedValue({ member, benchmark: PINNED });
    expect((await (await GET(request(), params("bench"))).json()).app).toEqual({ name: "bench", version: "v2" });
  });

  it("an entry without an app is a 404, before the workspace is read", async () => {
    mockAuthorize.mockResolvedValue({ member, benchmark: WITHOUT });
    expect((await GET(request(), params("plain"))).status).toBe(404);
    expect(mockWorkspace).not.toHaveBeenCalled();
  });

  it("the benchmark gate's answer stands", async () => {
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: "Not found" }, { status: 404 }));
    expect((await GET(request(), params("bench"))).status).toBe(404);
    expect(mockWorkspace).not.toHaveBeenCalled();
  });

  it("409 when the workspace has no swarm or no org", async () => {
    mockAuthorize.mockResolvedValue({ member, benchmark: WITH_APP });
    mockWorkspace.mockResolvedValueOnce({ swarm: null, sourceControlOrg: { githubLogin: "acme-org" } });
    expect((await GET(request(), params("bench"))).status).toBe(409);
    mockWorkspace.mockResolvedValueOnce({ swarm: { id: "swarm-1" }, sourceControlOrg: null });
    expect((await GET(request(), params("bench"))).status).toBe(409);
  });
});
