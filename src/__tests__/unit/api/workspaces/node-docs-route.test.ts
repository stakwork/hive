/**
 * Unit tests for PUT /api/workspaces/[slug]/nodes/[refId]/docs — the graph
 * workbench's docs save, keyed by ref_id and written straight to Jarvis.
 */

import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  db: { workspace: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/auth/workspace-access", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/workspace-access")>()),
  resolveWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/ai/graphWriteAuth", () => ({
  resolveGraphJarvis: vi.fn(),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  readNodeByRef: vi.fn(),
  updateNodeV2: vi.fn(),
}));

import { PUT } from "@/app/api/workspaces/[slug]/nodes/[refId]/docs/route";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { resolveGraphJarvis } from "@/lib/ai/graphWriteAuth";
import { readNodeByRef, updateNodeV2 } from "@/services/swarm/api/nodes";

const config = { jarvisUrl: "https://jarvis.test", apiKey: "key" };
const params = Promise.resolve({ slug: "ws", refId: "ref-1" });

const makeRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/workspaces/ws/nodes/ref-1/docs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function grant(role = "DEVELOPER") {
  (resolveWorkspaceAccess as Mock).mockResolvedValue({
    kind: "member",
    userId: "user-1",
    workspaceId: "ws-1",
    slug: "ws",
    role,
  });
  (db.workspace.findFirst as Mock).mockResolvedValue({ sourceControlOrgId: "org-1" });
  (resolveGraphJarvis as Mock).mockResolvedValue({
    ok: true,
    access: { workspaceId: "ws-1", workspaceSlug: "ws", config },
  });
}

describe("PUT /api/workspaces/[slug]/nodes/[refId]/docs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grant();
    (readNodeByRef as Mock).mockResolvedValue({ success: true, node_type: "Concept" });
    (updateNodeV2 as Mock).mockResolvedValue({ success: true });
  });

  test("returns 400 when docs is not a string", async () => {
    const res = await PUT(makeRequest({ docs: 42 }), { params });

    expect(res.status).toBe(400);
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("returns 401 when unauthenticated", async () => {
    (resolveWorkspaceAccess as Mock).mockResolvedValue({ kind: "unauthenticated" });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(401);
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("returns 403 below DEVELOPER", async () => {
    grant("VIEWER");

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(403);
    expect(updateNodeV2).not.toHaveBeenCalled();
  });

  test("returns 403 when Jarvis config can't be resolved", async () => {
    (resolveGraphJarvis as Mock).mockResolvedValue({ ok: false, error: "denied" });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(403);
    expect(readNodeByRef).not.toHaveBeenCalled();
  });

  test("returns 404 when the node is missing", async () => {
    (readNodeByRef as Mock).mockResolvedValue({ success: false });

    const res = await PUT(makeRequest({ docs: "x" }), { params });

    expect(res.status).toBe(404);
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
    expect(readNodeByRef).toHaveBeenCalledWith(config, "ref-1");
    expect(updateNodeV2).toHaveBeenCalledWith(config, "ref-1", { docs: "# New docs" });
    expect(await res.json()).toEqual({ success: true, ref_id: "ref-1", docs: "# New docs" });
  });
});
