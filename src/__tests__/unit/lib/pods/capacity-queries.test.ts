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
  buildPodUrl: vi.fn((podId: string, port: number | string) => `https://${podId}-${port}.workspaces.sphinx.chat`),
}));

import { db } from "@/lib/db";
import { getBasicVMDataFromPods } from "@/lib/pods/capacity-queries";

const mockPodFindMany = vi.mocked(db.pod.findMany);
const mockTaskFindMany = vi.mocked(db.task.findMany);

const SWARM_ID = "swarm-test-123";

function makePod(portMappings: unknown = null) {
  return {
    podId: "pod-abc",
    status: "RUNNING" as PodStatus,
    usageStatus: "UNUSED" as PodUsageStatus,
    usageStatusMarkedBy: null,
    password: "secret",
    createdAt: new Date(),
    portMappings,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTaskFindMany.mockResolvedValue([]);
});

describe("getBasicVMDataFromPods — url construction", () => {
  it("uses first non-control port when portMappings has [3000, 15552]", async () => {
    mockPodFindMany.mockResolvedValue([makePod([3000, 15552])] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.url).toBe("https://pod-abc-3000.workspaces.sphinx.chat");
  });

  it("falls back to port 3000 when portMappings is null", async () => {
    mockPodFindMany.mockResolvedValue([makePod(null)] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.url).toBe("https://pod-abc-3000.workspaces.sphinx.chat");
  });

  it("falls back to port 3000 when portMappings is []", async () => {
    mockPodFindMany.mockResolvedValue([makePod([])] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.url).toBe("https://pod-abc-3000.workspaces.sphinx.chat");
  });

  it("falls back to port 3000 when portMappings is [15552] (only control port)", async () => {
    mockPodFindMany.mockResolvedValue([makePod([15552])] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.url).toBe("https://pod-abc-3000.workspaces.sphinx.chat");
  });

  it("does not use control port 15552 as the url port", async () => {
    mockPodFindMany.mockResolvedValue([makePod([3000, 15552])] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.url).not.toContain("-15552.");
  });
});

describe("getBasicVMDataFromPods — frontendUrl", () => {
  it("frontendUrl equals url (same resolved port)", async () => {
    mockPodFindMany.mockResolvedValue([makePod([3000, 15552])] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.frontendUrl).toBe(vm.url);
  });

  it("frontendUrl is set when portMappings is null (fallback)", async () => {
    mockPodFindMany.mockResolvedValue([makePod(null)] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.frontendUrl).toBe("https://pod-abc-3000.workspaces.sphinx.chat");
  });

  it("frontendUrl is set when portMappings is empty (fallback)", async () => {
    mockPodFindMany.mockResolvedValue([makePod([])] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.frontendUrl).toBe("https://pod-abc-3000.workspaces.sphinx.chat");
  });
});
