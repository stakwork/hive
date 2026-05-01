import { describe, it, expect, vi, beforeEach } from "vitest";
import { PodStatus, PodUsageStatus } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  db: {
    pod: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/pods/queries", () => ({
  POD_BASE_DOMAIN: "workspaces.sphinx.chat",
}));

import { db } from "@/lib/db";
import { getBasicVMDataFromPods } from "@/lib/pods/capacity-queries";

const mockPodFindMany = vi.mocked(db.pod.findMany);
const mockTaskFindMany = vi.mocked(db.task.findMany);

const SWARM_ID = "swarm-test-123";

function makePod() {
  return {
    podId: "pod-abc",
    status: "RUNNING" as PodStatus,
    usageStatus: "UNUSED" as PodUsageStatus,
    usageStatusMarkedBy: null,
    password: "secret",
    createdAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTaskFindMany.mockResolvedValue([]);
});

describe("getBasicVMDataFromPods — IDE url construction", () => {
  it("returns the bare pod hostname (no port suffix) as the IDE url", async () => {
    mockPodFindMany.mockResolvedValue([makePod()] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.url).toBe("https://pod-abc.workspaces.sphinx.chat");
  });

  it("does not include any port in the url", async () => {
    mockPodFindMany.mockResolvedValue([makePod()] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    // No `-NNNN.` segment between the subdomain and the base domain.
    expect(vm.url).not.toMatch(/-\d+\./);
  });

  it("does not synthesize a frontendUrl (resolved on-demand instead)", async () => {
    mockPodFindMany.mockResolvedValue([makePod()] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    // The capacity query no longer ships a frontendUrl; that lookup happens
    // on-click via /api/w/[slug]/pool/[podId]/frontend-url.
    expect((vm as { frontendUrl?: string }).frontendUrl).toBeUndefined();
  });
});
