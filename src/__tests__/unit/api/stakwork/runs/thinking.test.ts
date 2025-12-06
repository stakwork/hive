import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/stakwork/runs/[runId]/thinking/route";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";

vi.mock("next-auth");
vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/service-factory");

describe("GET /api/stakwork/runs/[runId]/thinking", () => {
  const mockSession = {
    user: {
      id: "user-123",
      email: "test@example.com",
    },
  };

  const mockStakworkRun = {
    id: "run-123",
    projectId: 456,
    thinkingArtifacts: null,
    workspace: {
      id: "workspace-789",
      members: [{ userId: "user-123" }],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 if user is not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const req = new Request("http://localhost/api/stakwork/runs/run-123/thinking");
    const response = await GET(req as any, { params: Promise.resolve({ runId: "run-123" }) });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should return 404 if stakwork run not found", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.stakworkRun.findUnique).mockResolvedValue(null);

    const req = new Request("http://localhost/api/stakwork/runs/run-123/thinking");
    const response = await GET(req as any, { params: Promise.resolve({ runId: "run-123" }) });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Stakwork run not found");
  });

  it("should return 403 if user does not have access to workspace", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.stakworkRun.findUnique).mockResolvedValue({
      ...mockStakworkRun,
      workspace: {
        ...mockStakworkRun.workspace,
        members: [],
      },
    } as any);

    const req = new Request("http://localhost/api/stakwork/runs/run-123/thinking");
    const response = await GET(req as any, { params: Promise.resolve({ runId: "run-123" }) });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Access denied");
  });

  it("should return stored thinking artifacts if available", async () => {
    const storedArtifacts = [
      {
        stepId: "step-1",
        stepName: "Research",
        log: "Starting research",
        output: "Results found",
        stepState: "completed",
      },
    ];

    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.stakworkRun.findUnique).mockResolvedValue({
      ...mockStakworkRun,
      thinkingArtifacts: storedArtifacts,
    } as any);

    const req = new Request("http://localhost/api/stakwork/runs/run-123/thinking");
    const response = await GET(req as any, { params: Promise.resolve({ runId: "run-123" }) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.artifacts).toEqual(storedArtifacts);
    expect(stakworkService).not.toHaveBeenCalled();
  });

  it("should fetch and format thinking artifacts from Stakwork API", async () => {
    const workflowData = {
      workflowData: {
        transitions: [
          {
            step_id: "step-1",
            step_name: "Research",
            log: "Starting research",
            output: "Results found",
            step_state: "completed",
          },
          {
            step_id: "step-2",
            step_name: "Analysis",
            log: "Analyzing data",
            step_state: "running",
          },
          {
            step_id: "step-3",
            step_name: "Empty Step",
          },
        ],
      },
    };

    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.stakworkRun.findUnique).mockResolvedValue(mockStakworkRun as any);
    vi.mocked(stakworkService).mockReturnValue({
      getWorkflowData: vi.fn().mockResolvedValue(workflowData),
    } as any);

    const req = new Request("http://localhost/api/stakwork/runs/run-123/thinking");
    const response = await GET(req as any, { params: Promise.resolve({ runId: "run-123" }) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.artifacts).toHaveLength(2);
    expect(data.artifacts[0]).toEqual({
      stepId: "step-1",
      stepName: "Research",
      log: "Starting research",
      output: "Results found",
      stepState: "completed",
    });
    expect(data.artifacts[1]).toEqual({
      stepId: "step-2",
      stepName: "Analysis",
      log: "Analyzing data",
      output: undefined,
      stepState: "running",
    });
  });

  it("should return 404 if workflow data not found", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.stakworkRun.findUnique).mockResolvedValue(mockStakworkRun as any);
    vi.mocked(stakworkService).mockReturnValue({
      getWorkflowData: vi.fn().mockResolvedValue(null),
    } as any);

    const req = new Request("http://localhost/api/stakwork/runs/run-123/thinking");
    const response = await GET(req as any, { params: Promise.resolve({ runId: "run-123" }) });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Workflow data not found");
  });

  it("should handle errors gracefully", async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.stakworkRun.findUnique).mockRejectedValue(
      new Error("Database error")
    );

    const req = new Request("http://localhost/api/stakwork/runs/run-123/thinking");
    const response = await GET(req as any, { params: Promise.resolve({ runId: "run-123" }) });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch thinking artifacts");
  });
});
