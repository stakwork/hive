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
    strutRun: {
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/pods/queries", async (orig) => ({
  ...(await orig<typeof import("@/lib/pods/queries")>()),
  POD_BASE_DOMAIN: "workspaces.sphinx.chat",
}));

import { db } from "@/lib/db";
import { getBasicVMDataFromPods } from "@/lib/pods/capacity-queries";

const mockPodFindMany = vi.mocked(db.pod.findMany);
const mockTaskFindMany = vi.mocked(db.task.findMany);
const mockStrutRunFindMany = vi.mocked(db.strutRun.findMany);
const mockUserFindMany = vi.mocked(db.user.findMany);

const SWARM_ID = "swarm-test-123";

function makePod(over: Partial<ReturnType<typeof basePod>> = {}) {
  return { ...basePod(), ...over };
}

function basePod() {
  return {
    podId: "pod-abc",
    status: "RUNNING" as PodStatus,
    usageStatus: "UNUSED" as PodUsageStatus,
    usageStatusMarkedBy: null as string | null,
    usageStatusMarkedAt: null as Date | null,
    password: "secret",
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTaskFindMany.mockResolvedValue([]);
  mockStrutRunFindMany.mockResolvedValue([]);
  mockUserFindMany.mockResolvedValue([]);
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

describe("getBasicVMDataFromPods — who holds a used pod", () => {
  const markedAt = new Date("2026-10-08T12:00:00Z");

  it("a task's id resolves to the task, as before; marked_at is when it was claimed, not when the pod was made", async () => {
    mockPodFindMany.mockResolvedValue([makePod({ usageStatus: "USED", usageStatusMarkedBy: "task-1", usageStatusMarkedAt: markedAt })] as never);
    mockTaskFindMany.mockResolvedValue([{ id: "task-1", title: "Fix login", createdBy: { name: "Ann", image: null } }] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.assignedTask).toEqual({ id: "task-1", title: "Fix login", creator: { name: "Ann", image: null } });
    expect(vm.assignedJob).toBeNull();
    expect(vm.marked_at).toBe(markedAt.toISOString());
    expect(mockStrutRunFindMany).not.toHaveBeenCalled();
  });

  it("a `job:<id>` claimant resolves through the job's first turn to its title and who started it", async () => {
    mockPodFindMany.mockResolvedValue([makePod({ usageStatus: "USED", usageStatusMarkedBy: "job:j-1", usageStatusMarkedAt: markedAt })] as never);
    mockStrutRunFindMany.mockResolvedValue([
      { jobId: "j-1", userId: "u-1", input: { prompt: "first", title: "Dark mode" } },
      { jobId: "j-1", userId: "u-1", input: { prompt: "second", title: "Dark mode" } },
    ] as never);
    mockUserFindMany.mockResolvedValue([{ id: "u-1", name: "Bo", image: "https://img/bo" }] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.assignedJob).toEqual({ id: "j-1", title: "Dark mode", creator: { name: "Bo", image: "https://img/bo" } });
    expect(vm.assignedTask).toBeNull();
    expect(vm.user_info).toBe("job:j-1");
    expect(vm.marked_at).toBe(markedAt.toISOString());
    // The job's id is never looked up as a task.
    expect(mockTaskFindMany).not.toHaveBeenCalled();
    expect(mockStrutRunFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: { in: ["j-1"] }, kind: "job_turn" } }));
  });

  it("a job hive has no row for still shows as a job", async () => {
    mockPodFindMany.mockResolvedValue([makePod({ usageStatus: "USED", usageStatusMarkedBy: "job:gone", usageStatusMarkedAt: markedAt })] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.assignedJob).toEqual({ id: "gone", title: "Job", creator: { name: null, image: null } });
  });

  it("an unused pod has no claimant and no marked_at", async () => {
    mockPodFindMany.mockResolvedValue([makePod()] as never);
    const [vm] = await getBasicVMDataFromPods(SWARM_ID);
    expect(vm.assignedTask).toBeNull();
    expect(vm.assignedJob).toBeNull();
    expect(vm.marked_at).toBeNull();
  });
});
