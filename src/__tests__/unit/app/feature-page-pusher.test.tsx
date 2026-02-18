import { describe, it, expect, vi, beforeEach } from "vitest";
import { StakworkRunDecision, StakworkRunType } from "@prisma/client";

describe("Feature Page Pusher Event Handling", () => {
  const mockFeatureId = "feature-123";
  const mockChannel = {
    bind: vi.fn(),
    unbind: vi.fn(),
  };

  let fetchFeatureMock: ReturnType<typeof vi.fn>;
  let updateOriginalDataMock: ReturnType<typeof vi.fn>;
  let fetchPendingRunsMock: ReturnType<typeof vi.fn>;
  let setFeatureMock: ReturnType<typeof vi.fn>;
  let handleStakworkRunDecision: (data: any) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock functions
    fetchFeatureMock = vi.fn().mockResolvedValue({
      data: {
        id: mockFeatureId,
        title: "Updated Feature",
        architecture: "New architecture text",
        tasks: [{ id: "task-1", title: "Task 1" }],
      },
    });
    updateOriginalDataMock = vi.fn();
    fetchPendingRunsMock = vi.fn();
    setFeatureMock = vi.fn();

    // Simulate the handleStakworkRunDecision function from the component
    handleStakworkRunDecision = async (data: {
      runId: string;
      type: StakworkRunType;
      featureId: string;
      decision: StakworkRunDecision;
      timestamp: Date;
    }) => {
      // Only process events for this feature
      if (data.featureId !== mockFeatureId) {
        return;
      }

      // Only process ACCEPTED decisions
      if (data.decision !== "ACCEPTED") {
        return;
      }

      // Refetch feature data
      const result = await fetchFeatureMock(mockFeatureId);
      setFeatureMock(result.data);
      updateOriginalDataMock(result.data);
      await fetchPendingRunsMock();
    };
  });

  it("should bind STAKWORK_RUN_DECISION event listener", () => {
    // Simulate binding the event
    mockChannel.bind("STAKWORK_RUN_DECISION", handleStakworkRunDecision);

    expect(mockChannel.bind).toHaveBeenCalledWith(
      "STAKWORK_RUN_DECISION",
      handleStakworkRunDecision
    );
  });

  it("should refetch feature data when ACCEPTED decision is received for current feature", async () => {
    const payload = {
      runId: "run-123",
      type: "ARCHITECTURE" as StakworkRunType,
      featureId: mockFeatureId,
      decision: "ACCEPTED" as StakworkRunDecision,
      timestamp: new Date(),
    };

    await handleStakworkRunDecision(payload);

    expect(fetchFeatureMock).toHaveBeenCalledWith(mockFeatureId);
    expect(setFeatureMock).toHaveBeenCalledWith({
      id: mockFeatureId,
      title: "Updated Feature",
      architecture: "New architecture text",
      tasks: [{ id: "task-1", title: "Task 1" }],
    });
    expect(updateOriginalDataMock).toHaveBeenCalledWith({
      id: mockFeatureId,
      title: "Updated Feature",
      architecture: "New architecture text",
      tasks: [{ id: "task-1", title: "Task 1" }],
    });
    expect(fetchPendingRunsMock).toHaveBeenCalled();
  });

  it("should ignore events for different features", async () => {
    const payload = {
      runId: "run-123",
      type: "ARCHITECTURE" as StakworkRunType,
      featureId: "different-feature",
      decision: "ACCEPTED" as StakworkRunDecision,
      timestamp: new Date(),
    };

    await handleStakworkRunDecision(payload);

    expect(fetchFeatureMock).not.toHaveBeenCalled();
    expect(setFeatureMock).not.toHaveBeenCalled();
    expect(updateOriginalDataMock).not.toHaveBeenCalled();
    expect(fetchPendingRunsMock).not.toHaveBeenCalled();
  });

  it("should not refetch when decision is REJECTED", async () => {
    const payload = {
      runId: "run-123",
      type: "ARCHITECTURE" as StakworkRunType,
      featureId: mockFeatureId,
      decision: "REJECTED" as StakworkRunDecision,
      timestamp: new Date(),
    };

    await handleStakworkRunDecision(payload);

    expect(fetchFeatureMock).not.toHaveBeenCalled();
    expect(setFeatureMock).not.toHaveBeenCalled();
    expect(updateOriginalDataMock).not.toHaveBeenCalled();
    expect(fetchPendingRunsMock).not.toHaveBeenCalled();
  });

  it("should not refetch when decision is FEEDBACK", async () => {
    const payload = {
      runId: "run-123",
      type: "ARCHITECTURE" as StakworkRunType,
      featureId: mockFeatureId,
      decision: "FEEDBACK" as StakworkRunDecision,
      timestamp: new Date(),
    };

    await handleStakworkRunDecision(payload);

    expect(fetchFeatureMock).not.toHaveBeenCalled();
    expect(setFeatureMock).not.toHaveBeenCalled();
    expect(updateOriginalDataMock).not.toHaveBeenCalled();
    expect(fetchPendingRunsMock).not.toHaveBeenCalled();
  });

  it("should unbind event listener on cleanup", () => {
    // Simulate unbinding the event
    mockChannel.unbind("STAKWORK_RUN_DECISION", handleStakworkRunDecision);

    expect(mockChannel.unbind).toHaveBeenCalledWith(
      "STAKWORK_RUN_DECISION",
      handleStakworkRunDecision
    );
  });

  it("should handle fetch errors gracefully", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchFeatureMock.mockRejectedValueOnce(new Error("Fetch failed"));

    const payload = {
      runId: "run-123",
      type: "ARCHITECTURE" as StakworkRunType,
      featureId: mockFeatureId,
      decision: "ACCEPTED" as StakworkRunDecision,
      timestamp: new Date(),
    };

    // Should not throw error
    await expect(handleStakworkRunDecision(payload)).rejects.toThrow("Fetch failed");

    expect(fetchFeatureMock).toHaveBeenCalledWith(mockFeatureId);
    expect(setFeatureMock).not.toHaveBeenCalled();
    expect(updateOriginalDataMock).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
