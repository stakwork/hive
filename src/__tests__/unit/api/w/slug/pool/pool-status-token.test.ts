import { NextRequest, NextResponse } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth/pod-access", () => ({ resolvePodCaller: vi.fn() }));
vi.mock("@/lib/auth/workspace-access", () => ({
  resolveWorkspaceAccess: vi.fn(),
  requireReadAccess: vi.fn(),
}));
vi.mock("@/lib/pods/status-queries", () => ({ getPoolStatusFromPods: vi.fn() }));
vi.mock("@/lib/pods/rollout", () => ({ loadPoolRollout: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { swarm: { findFirst: vi.fn() }, pod: { count: vi.fn() } },
}));

import { GET } from "@/app/api/w/[slug]/pool/status/route";
import { resolvePodCaller } from "@/lib/auth/pod-access";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";
import { getPoolStatusFromPods } from "@/lib/pods/status-queries";
import { loadPoolRollout } from "@/lib/pods/rollout";
import { db } from "@/lib/db";

const params = { params: Promise.resolve({ slug: "acme" }) };
const url = "http://localhost/api/w/acme/pool/status";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.swarm.findFirst).mockResolvedValue({ id: "sw", minimumVms: 2, minimumPods: 3 } as never);
  vi.mocked(getPoolStatusFromPods).mockResolvedValue({ runningVms: 1 } as never);
});

describe("GET pool/status", () => {
  it("public/session path is unchanged and has no rollout", async () => {
    vi.mocked(requireReadAccess).mockReturnValue({ workspaceId: "ws-1" } as never);
    const res = await GET(new NextRequest(url), params);
    const json = await res.json();
    expect(resolvePodCaller).not.toHaveBeenCalled();
    expect(json).toEqual({ success: true, data: { status: { runningVms: 1 } } });
    expect(loadPoolRollout).not.toHaveBeenCalled();
    expect(resolveWorkspaceAccess).toHaveBeenCalled();
  });

  it("token path adds rollout, flaggedPods, minimums", async () => {
    vi.mocked(resolvePodCaller).mockResolvedValue({ kind: "org", workspaceId: "ws-1" } as never);
    vi.mocked(loadPoolRollout).mockResolvedValue({ state: "ready" } as never);
    vi.mocked(db.pod.count).mockResolvedValue(2 as never);
    const res = await GET(new NextRequest(url, { headers: { "x-api-token": "hiveorg_x" } }), params);
    const json = await res.json();
    expect(json.data).toEqual({
      status: { runningVms: 1 },
      rollout: { state: "ready" },
      flaggedPods: 2,
      minimumVms: 2,
      minimumPods: 3,
    });
    expect(resolveWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("token path: 401 passthrough, 403 -> 404", async () => {
    const hdr = { headers: { "x-api-token": "hiveorg_x" } };
    vi.mocked(resolvePodCaller).mockResolvedValueOnce(NextResponse.json({}, { status: 401 }) as never);
    expect((await GET(new NextRequest(url, hdr), params)).status).toBe(401);
    vi.mocked(resolvePodCaller).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }) as never);
    expect((await GET(new NextRequest(url, hdr), params)).status).toBe(404);
  });
});
