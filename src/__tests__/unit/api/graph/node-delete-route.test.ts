/**
 * Unit tests for DELETE /api/workspaces/[slug]/graph/node/[ref_id] — the
 * graph workbench's direct (no-proposal) Concept delete, keyed by ref_id.
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
  deleteSingleNode: vi.fn(),
}));

import { DELETE } from "@/app/api/workspaces/[slug]/graph/node/[ref_id]/route";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { deleteSingleNode, readNodeByRef } from "@/services/swarm/api/nodes";

const config = { jarvisUrl: getJarvisUrl("swarm-1"), apiKey: "key" };
const params = Promise.resolve({ slug: "ws", ref_id: "ref-1" });

const makeRequest = (query: Record<string, string> = {}) => {
  const url = new URL("http://localhost/api/workspaces/ws/graph/node/ref-1");
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString(), { method: "DELETE" });
};

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

describe("DELETE /api/workspaces/[slug]/graph/node/[ref_id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grant();
    (getSwarmAccessByWorkspaceId as Mock).mockResolvedValue({
      success: true,
      data: { swarmName: "swarm-1", swarmApiKey: "key" },
    });
    (readNodeByRef as Mock).mockResolvedValue({ success: true, node_type: "Concept" });
    (deleteSingleNode as Mock).mockResolvedValue({ success: true, mutedEdgeCount: 2 });
  });

  test("returns 401 when unauthenticated", async () => {
    (resolveWorkspaceAccess as Mock).mockResolvedValue({ kind: "unauthenticated" });

    const res = await DELETE(makeRequest(), { params });

    expect(res.status).toBe(401);
    expect(deleteSingleNode).not.toHaveBeenCalled();
  });

  test("returns 403 below DEVELOPER", async () => {
    grant("VIEWER");

    const res = await DELETE(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(getSwarmAccessByWorkspaceId).not.toHaveBeenCalled();
  });

  test("returns 400 when the workspace has no graph configured", async () => {
    (getSwarmAccessByWorkspaceId as Mock).mockResolvedValue({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });

    const res = await DELETE(makeRequest(), { params });

    expect(res.status).toBe(400);
    expect(readNodeByRef).not.toHaveBeenCalled();
  });

  test("returns 404 when the node can't be read", async () => {
    (readNodeByRef as Mock).mockResolvedValue({ success: true });

    const res = await DELETE(makeRequest(), { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Node "ref-1" not found' });
    expect(deleteSingleNode).not.toHaveBeenCalled();
  });

  test("returns 400 when the node is not a Concept", async () => {
    (readNodeByRef as Mock).mockResolvedValue({ success: true, node_type: "File" });

    const res = await DELETE(makeRequest(), { params });

    expect(res.status).toBe(400);
    expect(deleteSingleNode).not.toHaveBeenCalled();
  });

  test("returns 404 when the delete reports the node missing", async () => {
    (deleteSingleNode as Mock).mockResolvedValue({ success: false, notFound: true, error: "gone" });

    const res = await DELETE(makeRequest(), { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "gone" });
  });

  test("deletes through deleteSingleNode and echoes the ref_id", async () => {
    const res = await DELETE(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(readNodeByRef).toHaveBeenCalledWith(config, "ref-1", undefined);
    expect(deleteSingleNode).toHaveBeenCalledWith(config, "ref-1", undefined);
    expect(await res.json()).toEqual({ success: true, ref_id: "ref-1" });
  });

  test("passes the node's own (read-derived) namespace through to deleteSingleNode", async () => {
    (readNodeByRef as Mock).mockResolvedValue({
      success: true,
      node_type: "Concept",
      namespace: "other-ns",
    });

    const res = await DELETE(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(deleteSingleNode).toHaveBeenCalledWith(config, "ref-1", "other-ns");
  });

  test("a client-supplied namespace wins over the read-derived one, and is also used for the read", async () => {
    // Regression test: a Concept outside the default namespace shows fine in
    // the panel (it's read via a plain Cypher match, not namespace-scoped),
    // but Jarvis's single-node GET/DELETE default the lookup to "default"
    // when no namespace is given — so without threading the client's
    // namespace through, the read 404s before deleteSingleNode is ever
    // reached, and the user sees `Node "..." not found` for a node that
    // exists.
    (readNodeByRef as Mock).mockResolvedValue({
      success: true,
      node_type: "Concept",
      namespace: "read-derived-ns",
    });

    const res = await DELETE(makeRequest({ namespace: "client-ns" }), { params });

    expect(res.status).toBe(200);
    expect(readNodeByRef).toHaveBeenCalledWith(config, "ref-1", "client-ns");
    expect(deleteSingleNode).toHaveBeenCalledWith(config, "ref-1", "client-ns");
  });
});
