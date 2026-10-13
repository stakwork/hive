import { NextRequest, NextResponse } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth/pod-access", () => ({ resolvePodCaller: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    swarm: { findFirst: vi.fn() },
    pod: { findFirst: vi.fn(), findMany: vi.fn() },
    task: { findMany: vi.fn() },
    strutRun: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/pods/env-values", () => ({ loadAllStoredEnvValues: vi.fn() }));

import { GET as getPods } from "@/app/api/w/[slug]/pool/pods/route";
import { GET as getProcesses } from "@/app/api/w/[slug]/pool/[podId]/processes/route";
import { GET as getLogs } from "@/app/api/w/[slug]/pool/[podId]/logs/route";
import { resolvePodCaller } from "@/lib/auth/pod-access";
import { loadAllStoredEnvValues } from "@/lib/pods/env-values";
import { db } from "@/lib/db";

const ORG_CALLER = { kind: "org", workspaceId: "ws-1", orgId: "o", apiKeyId: "k", actingUserId: "u" };
const base = "http://localhost/api/w/acme/pool";
const req = (path: string) => new NextRequest(`${base}${path}`, { headers: { "x-api-token": "hiveorg_x" } });
const podParams = (podId = "pod-1") => ({ params: Promise.resolve({ slug: "acme", podId }) });
const slugParams = { params: Promise.resolve({ slug: "acme" }) };

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.mocked(resolvePodCaller).mockResolvedValue(ORG_CALLER as never);
  vi.mocked(loadAllStoredEnvValues).mockResolvedValue([]);
});

const authCases: Array<[string, () => Promise<Response>]> = [
  ["pods", () => getPods(req("/pods"), slugParams)],
  ["processes", () => getProcesses(req("/pod-1/processes"), podParams())],
  ["logs", () => getLogs(req("/pod-1/logs"), podParams())],
];

describe.each(authCases)("auth mapping: %s", (_name, call) => {
  it("401 for revoked key / no auth", async () => {
    vi.mocked(resolvePodCaller).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never);
    expect((await call()).status).toBe(401);
  });
  it("maps 403 (wrong org) to 404", async () => {
    vi.mocked(resolvePodCaller).mockResolvedValue(NextResponse.json({ error: "Access denied" }, { status: 403 }) as never);
    expect((await call()).status).toBe(404);
  });
});

describe("GET pool/pods", () => {
  const pushed = new Date("2026-01-02T00:00:00Z");
  const mkPod = (over: Record<string, unknown>) => ({
    podId: "p",
    status: "RUNNING",
    usageStatus: "UNUSED",
    usageStatusMarkedBy: null,
    usageStatusMarkedAt: null,
    createdAt: new Date("2026-01-03T00:00:00Z"),
    flaggedForRecreation: false,
    flaggedReason: null,
    flaggedAt: null,
    lastHealthCheck: null,
    ...over,
  });

  it("404 when no swarm", async () => {
    vi.mocked(db.swarm.findFirst).mockResolvedValue(null as never);
    const res = await getPods(req("/pods"), slugParams);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Pool not configured");
  });

  it("returns generation split, usedBy, and no password", async () => {
    vi.mocked(db.swarm.findFirst).mockResolvedValue({ id: "sw", poolPushedAt: pushed } as never);
    vi.mocked(db.pod.findMany).mockResolvedValue([
      mkPod({ podId: "new-1" }),
      mkPod({ podId: "old-used", createdAt: new Date("2026-01-01T00:00:00Z"), usageStatus: "USED", usageStatusMarkedBy: "task-1", password: "SECRET" }),
      mkPod({ podId: "old-free", createdAt: new Date("2026-01-01T00:00:00Z") }),
      mkPod({ podId: "job-pod", usageStatus: "USED", usageStatusMarkedBy: "job:j1" }),
    ] as never);
    vi.mocked(db.task.findMany).mockResolvedValue([{ id: "task-1", title: "T", createdBy: { name: null, image: null } }] as never);
    vi.mocked(db.strutRun.findMany).mockResolvedValue([{ jobId: "j1", userId: "u1", input: {} }] as never);
    vi.mocked(db.user.findMany).mockResolvedValue([] as never);

    const res = await getPods(req("/pods"), slugParams);
    const json = await res.json();
    const by = Object.fromEntries(json.data.pods.map((p: { podId: string }) => [p.podId, p]));
    expect(by["new-1"].generation).toBe("new");
    expect(by["new-1"].url).toBe("https://new-1.workspaces.sphinx.chat");
    expect(by["old-used"].generation).toBe("old");
    expect(by["old-used"].willUpdateWhenReleased).toBe(true);
    expect(by["old-free"].willUpdateWhenReleased).toBe(false);
    expect(by["old-used"].usedBy).toEqual({ kind: "task", id: "task-1", title: "T" });
    expect(by["job-pod"].usedBy).toMatchObject({ kind: "job", id: "j1" });
    expect(by["job-pod"].willUpdateWhenReleased).toBe(false);
    expect(JSON.stringify(json)).not.toContain("SECRET");
    expect(JSON.stringify(json)).not.toContain("password");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live=1 fetches jlist, nulls failures, still hides password", async () => {
    vi.mocked(db.swarm.findFirst).mockResolvedValue({ id: "sw", poolPushedAt: null } as never);
    vi.mocked(db.pod.findMany).mockResolvedValue([
      mkPod({ podId: "a", password: "SECRET" }),
      mkPod({ podId: "b", password: "SECRET" }),
    ] as never);
    fetchSpy.mockImplementation(async (url: string) =>
      url.includes("//a-")
        ? new Response(JSON.stringify([{ name: "x", status: "online" }]))
        : Promise.reject(new Error("down")),
    );
    const res = await getPods(req("/pods?live=1"), slugParams);
    const json = await res.json();
    const by = Object.fromEntries(json.data.pods.map((p: { podId: string }) => [p.podId, p]));
    expect(by.a.jlist).toEqual([{ name: "x", status: "online" }]);
    expect(by.b.jlist).toBeNull();
    expect(JSON.stringify(json)).not.toContain("SECRET");
  });
});

describe("GET pool/[podId]/processes", () => {
  it("404 for unknown pod", async () => {
    vi.mocked(db.pod.findFirst).mockResolvedValue(null as never);
    expect((await getProcesses(req("/x/processes"), podParams("x"))).status).toBe(404);
    expect(vi.mocked(db.pod.findFirst).mock.calls[0][0]).toMatchObject({
      where: { podId: "x", deletedAt: null, swarm: { workspaceId: "ws-1" } },
    });
  });

  it("returns processes", async () => {
    vi.mocked(db.pod.findFirst).mockResolvedValue({ podId: "pod-1", password: "pw" } as never);
    fetchSpy.mockResolvedValue(new Response(JSON.stringify([{ name: "frontend", status: "online" }])));
    const res = await getProcesses(req("/pod-1/processes"), podParams());
    expect(res.status).toBe(200);
    expect((await res.json()).data.processes).toEqual([{ name: "frontend", status: "online" }]);
  });

  it("502 when unreachable", async () => {
    vi.mocked(db.pod.findFirst).mockResolvedValue({ podId: "pod-1", password: "pw" } as never);
    fetchSpy.mockRejectedValue(new Error("timeout"));
    const res = await getProcesses(req("/pod-1/processes"), podParams());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("pod_unreachable");
  });
});

describe("GET pool/[podId]/logs", () => {
  const pod = (over: Record<string, unknown> = {}) => ({
    podId: "pod-1",
    password: "hunter2-pw",
    status: "RUNNING",
    swarm: { id: "sw", environmentVariables: null },
    ...over,
  });

  it("400 on bad process name", async () => {
    const res = await getLogs(req("/pod-1/logs?process=a%20b;ls"), podParams());
    expect(res.status).toBe(400);
  });

  it("404 unknown pod, 409 not running", async () => {
    vi.mocked(db.pod.findFirst).mockResolvedValueOnce(null as never);
    expect((await getLogs(req("/pod-1/logs"), podParams())).status).toBe(404);
    vi.mocked(db.pod.findFirst).mockResolvedValueOnce(pod({ status: "FAILED" }) as never);
    const res = await getLogs(req("/pod-1/logs"), podParams());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "pod_not_running", status: "FAILED" });
  });

  it("redacts password and env values (>=6 chars only) and uses process path", async () => {
    vi.mocked(db.pod.findFirst).mockResolvedValue(pod() as never);
    vi.mocked(loadAllStoredEnvValues).mockResolvedValue(["supersecretvalue", "abc"]);
    fetchSpy.mockResolvedValue(new Response("pw=hunter2-pw key=supersecretvalue short=abc"));
    const res = await getLogs(req("/pod-1/logs?process=my.app-1&lines=50"), podParams());
    const json = await res.json();
    expect(json.data.logs).toBe("pw=[redacted] key=[redacted] short=abc");
    expect(json.data.process).toBe("my.app-1");
    expect(json.data.truncated).toBe(false);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://pod-1-15552.workspaces.sphinx.chat/logs/my.app-1?lines=50");
  });

  it("clamps lines and defaults to 200", async () => {
    vi.mocked(db.pod.findFirst).mockResolvedValue(pod() as never);
    fetchSpy.mockImplementation(async () => new Response("x"));
    await getLogs(req("/pod-1/logs?lines=99999"), podParams());
    expect(fetchSpy.mock.calls[0][0]).toContain("/logs?lines=1000");
    await getLogs(req("/pod-1/logs?lines=0"), podParams());
    expect(fetchSpy.mock.calls[1][0]).toContain("lines=1");
    const res = await getLogs(req("/pod-1/logs"), podParams());
    expect(fetchSpy.mock.calls[2][0]).toContain("lines=200");
    expect((await res.json()).data.lines).toBe(200);
  });

  it("keeps only the last 200KB and flags truncated", async () => {
    vi.mocked(db.pod.findFirst).mockResolvedValue(pod() as never);
    fetchSpy.mockResolvedValue(new Response("A".repeat(150 * 1024) + "B".repeat(150 * 1024)));
    const json = await (await getLogs(req("/pod-1/logs"), podParams())).json();
    expect(json.data.truncated).toBe(true);
    expect(json.data.logs.length).toBe(200 * 1024);
    expect(json.data.logs.endsWith("B")).toBe(true);
    expect(json.data.logs.startsWith("A")).toBe(true);
  });

  it("502 on fetch failure and non-OK", async () => {
    vi.mocked(db.pod.findFirst).mockResolvedValue(pod() as never);
    fetchSpy.mockRejectedValueOnce(new Error("x"));
    expect((await getLogs(req("/pod-1/logs"), podParams())).status).toBe(502);
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const res = await getLogs(req("/pod-1/logs"), podParams());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "pod_unreachable", status: 500 });
  });
});
