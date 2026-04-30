import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBasicVMDataFromPods } from "@/lib/pods/capacity-queries";
import { POD_PORTS } from "@/lib/pods/constants";

// Mock DB
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

// Mock buildPodUrl to return predictable values
vi.mock("@/lib/pods/queries", () => ({
  buildPodUrl: vi.fn((podId: string, port: string) => `https://${podId}-${port}.example.com`),
}));

import { db } from "@/lib/db";
import { buildPodUrl } from "@/lib/pods/queries";

const mockDb = db as { pod: { findMany: ReturnType<typeof vi.fn> }; task: { findMany: ReturnType<typeof vi.fn> } };

function makeDbPod(overrides: Record<string, unknown> = {}) {
  return {
    podId: "pod-abc123",
    status: "RUNNING",
    usageStatus: "UNUSED",
    usageStatusMarkedBy: null,
    password: "secret",
    createdAt: new Date("2024-01-01"),
    portMappings: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.task.findMany.mockResolvedValue([]);
});

describe("getBasicVMDataFromPods — frontendUrl computation", () => {
  it("returns frontendUrl using FRONTEND_FALLBACK port when portMappings is null", async () => {
    mockDb.pod.findMany.mockResolvedValue([makeDbPod({ portMappings: null })]);

    const result = await getBasicVMDataFromPods("swarm-1");

    expect(result[0].frontendUrl).toBe(
      `https://pod-abc123-${POD_PORTS.FRONTEND_FALLBACK}.example.com`
    );
    expect(buildPodUrl).toHaveBeenCalledWith("pod-abc123", POD_PORTS.FRONTEND_FALLBACK);
  });

  it("returns frontendUrl using FRONTEND_FALLBACK port when portMappings is empty array", async () => {
    mockDb.pod.findMany.mockResolvedValue([makeDbPod({ portMappings: [] })]);

    const result = await getBasicVMDataFromPods("swarm-1");

    expect(result[0].frontendUrl).toBe(
      `https://pod-abc123-${POD_PORTS.FRONTEND_FALLBACK}.example.com`
    );
  });

  it("returns frontendUrl when portMappings contains port 3000", async () => {
    mockDb.pod.findMany.mockResolvedValue([
      makeDbPod({ portMappings: [8080, 3000, 5000] }),
    ]);

    const result = await getBasicVMDataFromPods("swarm-1");

    expect(result[0].frontendUrl).toBe(
      `https://pod-abc123-${POD_PORTS.FRONTEND_FALLBACK}.example.com`
    );
  });

  it("returns undefined frontendUrl when portMappings has ports but not 3000", async () => {
    mockDb.pod.findMany.mockResolvedValue([
      makeDbPod({ portMappings: [8080, 5000] }),
    ]);

    const result = await getBasicVMDataFromPods("swarm-1");

    expect(result[0].frontendUrl).toBeUndefined();
  });

  it("returns frontendUrl for multiple pods independently", async () => {
    mockDb.pod.findMany.mockResolvedValue([
      makeDbPod({ podId: "pod-1", portMappings: [3000] }),
      makeDbPod({ podId: "pod-2", portMappings: null }),
      makeDbPod({ podId: "pod-3", portMappings: [8080] }),
    ]);

    const result = await getBasicVMDataFromPods("swarm-1");

    expect(result[0].frontendUrl).toContain("pod-1");
    expect(result[1].frontendUrl).toContain("pod-2");
    expect(result[2].frontendUrl).toBeUndefined();
  });
});
