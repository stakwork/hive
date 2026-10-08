/**
 * Unit tests for PUT /api/workspaces/[slug]/graph/node/[ref_id]/docs — the
 * graph workbench's docs save, keyed by ref_id and written straight to Jarvis.
 */

import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/workspace-access", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/workspace-access")>()),
  resolveWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: vi.fn(),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  readNodeByRef: vi.fn(),
  updateNodeV2: vi.fn(),
}));

import { PUT } from "@/app/api/workspaces/[slug]/graph/node/[ref_id]/docs/route";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { readNodeByRef, updateNodeV2 } from "@/services/swarm/api/nodes";

const config = { jarvisUrl: getJarvisUrl("swarm-1"), apiKey: "key" };
const params = Promise.resolve({ slug: "ws", ref_id: "ref-1" });

const makeRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/workspaces/ws/graph/node/ref-1/docs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function grant(role = "DEVELOPER", extra: Record<string, unknown> = {}) {
  (resolveWorkspaceAccess as Mock).mockResolvedValue({
    kind: "member",
    userId: "user-1",
    workspaceId: "ws-1",
    slug: "ws",
    role,
    ...extra,
  });
}

describe("PUT /api/workspaces/[slug]/graph/node/[ref_id]/docs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grant();
    (getSwarmAccessByWorkspaceId as Mock).mockResolvedValue({
      success: true,
      data: { swarmName: "swarm-1", swarmApiKey: "key" },
    });
    (readNodeByRef as Mock).mockResolvedValue({ success: true, node_type: "Concept" });
    (updateNodeV2 as Mock).mockResolvedValue({ success: true });
  });

  test("returns 400 when docs is not a string", async () => {
    const res = await PUT(makeRequest({ docs: 42 }), { params });

    expect(res.status).toBe(400);
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("returns 401 when unauthenticated, whatever the body", async () => {
    (resolveWorkspaceAccess as Mock).mockResolvedValue({ kind: "unauthenticated" });

    const res = await PUT(makeRequest({ docs: 42 }), { params });

    expect(res.status).toBe(401);
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("returns 403 below DEVELOPER", async () => {
    grant("VIEWER");

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(403);
    expect(getSwarmAccessByWorkspaceId).not.toHaveBeenCalled();
  });

  test("lets a super-admin who isn't a member save", async () => {
    grant("OWNER", { superAdmin: true });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(200);
    expect(updateNodeV2).toHaveBeenCalled();
  });

  test("returns 400 when the workspace has no graph configured", async () => {
    (getSwarmAccessByWorkspaceId as Mock).mockResolvedValue({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(400);
    expect(readNodeByRef).not.toHaveBeenCalled();
  });

  test("returns 404 when Jarvis has no such node", async () => {
    (readNodeByRef as Mock).mockResolvedValue({ success: false, status: "404" });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(404);
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("returns 404 when the read comes back without a node", async () => {
    (readNodeByRef as Mock).mockResolvedValue({ success: true });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(404);
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("returns 502, not 404, when Jarvis can't be read", async () => {
    (readNodeByRef as Mock).mockResolvedValue({
      success: false,
      status: "500",
      message: "Request failed with status 500",
    });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Request failed with status 500" });
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("returns 400 when the node is not a Concept", async () => {
    (readNodeByRef as Mock).mockResolvedValue({ success: true, node_type: "File" });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(400);
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("returns 502 when the Jarvis update fails", async () => {
    (updateNodeV2 as Mock).mockResolvedValue({ success: false, message: "boom" });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(502);
  });

  test("writes docs through updateNodeV2 and echoes them", async () => {
    const res = await PUT(makeRequest({ docs: "# New docs" }), { params });

    expect(res.status).toBe(200);
    expect(getSwarmAccessByWorkspaceId).toHaveBeenCalledWith("ws-1");
    expect(readNodeByRef).toHaveBeenCalledWith(config, "ref-1", undefined);
    expect(updateNodeV2).toHaveBeenCalledWith(config, "ref-1", { docs: "# New docs" }, undefined);
    expect(await res.json()).toEqual({ success: true, ref_id: "ref-1", docs: "# New docs" });
  });

  test("passes the node's namespace through to updateNodeV2", async () => {
    (readNodeByRef as Mock).mockResolvedValue({
      success: true,
      node_type: "Concept",
      namespace: "other-ns",
    });

    const res = await PUT(makeRequest({ docs: "# New docs" }), { params });

    expect(res.status).toBe(200);
    expect(updateNodeV2).toHaveBeenCalledWith(config, "ref-1", { docs: "# New docs" }, "other-ns");
  });

  test("forwards a client-supplied namespace to both the read and the write", async () => {
    // The client already knows the node's namespace (its own read of the node
    // isn't namespace-scoped) — it should win over whatever (if anything)
    // readNodeByRef's own, possibly namespace-scoped, lookup finds.
    const res = await PUT(makeRequest({ docs: "# New docs", namespace: "client-ns" }), { params });

    expect(res.status).toBe(200);
    expect(readNodeByRef).toHaveBeenCalledWith(config, "ref-1", "client-ns");
    expect(updateNodeV2).toHaveBeenCalledWith(config, "ref-1", { docs: "# New docs" }, "client-ns");
  });
});
