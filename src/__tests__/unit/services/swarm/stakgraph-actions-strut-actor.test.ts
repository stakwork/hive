/**
 * `strutActor` on a sync/ingest trigger rides the stakgraph body as
 * `strut_actor` (stakgraph#1777: standalone forwards it to mcp's
 * `/repo/describe` as `x-strut-actor`, so the descriptions run as a lab
 * workflow billed to that person). Absent, the body is as before.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const { mockSwarmApiRequest } = vi.hoisted(() => ({ mockSwarmApiRequest: vi.fn() }));

vi.mock("@/services/swarm/api/swarm", () => ({ swarmApiRequest: mockSwarmApiRequest }));
vi.mock("@/lib/utils/stakgraph-url", () => ({ getStakgraphUrl: (name: string) => `https://${name}:7799` }));

import { triggerAsyncSync, triggerIngestAsync } from "@/services/swarm/stakgraph-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockSwarmApiRequest.mockResolvedValue({ ok: true, status: 200, data: { request_id: "req-1" } });
});

describe("strut_actor on the stakgraph sync bodies", () => {
  test("triggerAsyncSync sends it beside the other options", async () => {
    await triggerAsyncSync("swarm1", "key", "https://github.com/o/r", undefined, "https://hive/cb", false, {
      embeddings: true,
      strutActor: "alice-u1",
    });
    const { data } = mockSwarmApiRequest.mock.calls[0][0];
    expect(data).toMatchObject({ repo_url: "https://github.com/o/r", embeddings: "true", strut_actor: "alice-u1" });
  });

  test("triggerIngestAsync sends it too", async () => {
    await triggerIngestAsync("swarm1", "key", "https://github.com/o/r", { username: "u", pat: "p" }, undefined, false, {
      strutActor: "alice-u1",
    });
    const { data } = mockSwarmApiRequest.mock.calls[0][0];
    expect(data.strut_actor).toBe("alice-u1");
    expect(data.realtime).toBe(true);
  });

  test("without an actor the body has no strut_actor", async () => {
    await triggerAsyncSync("swarm1", "key", "https://github.com/o/r", undefined, undefined, false, { docs: true });
    await triggerAsyncSync("swarm1", "key", "https://github.com/o/r");
    for (const [{ data }] of mockSwarmApiRequest.mock.calls) {
      expect(data).not.toHaveProperty("strut_actor");
    }
  });
});
