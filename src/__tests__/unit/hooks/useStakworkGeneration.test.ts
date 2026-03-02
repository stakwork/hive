import { renderHook, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useStakworkGeneration } from "@/hooks/useStakworkGeneration";

const mockChannel = {
  bind: vi.fn(),
  unbind: vi.fn(),
};

const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
};

const mockWorkspace = {
  id: "workspace-123",
  slug: "test-workspace",
};

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({ workspace: mockWorkspace })),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

global.fetch = vi.fn();

describe("useStakworkGeneration", () => {
  const featureId = "feature-123";
  const type = "ARCHITECTURE";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [] }),
    } as Response);
  });

  describe("error handling", () => {
    it("should handle getPusherClient throwing error gracefully", async () => {
      const pusher = await import("@/lib/pusher");
      
      // Mock getPusherClient to throw
      vi.mocked(pusher.getPusherClient).mockImplementation(() => {
        throw new Error("Pusher environment variables are not configured");
      });

      // Hook should render without error
      expect(() => {
        renderHook(() =>
          useStakworkGeneration({
            featureId,
            type: type as "ARCHITECTURE",
            enabled: true,
          })
        );
      }).not.toThrow();

      // No subscription should be attempted
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
      expect(mockChannel.bind).not.toHaveBeenCalled();
    });
  });
});
