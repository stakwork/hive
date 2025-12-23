import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/cron/auto-launch-pods/route";
import { NextRequest } from "next/server";
import * as autoLaunchPodsService from "@/services/auto-launch-pods-cron";

vi.mock("@/services/auto-launch-pods-cron");

describe("Auto-launch Pods Cron Endpoint", () => {
  const mockExecuteAutoLaunchPods = vi.spyOn(
    autoLaunchPodsService,
    "executeAutoLaunchPods"
  );

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  describe("Authentication", () => {
    it("should return 401 when CRON_SECRET is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/cron/auto-launch-pods");

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(mockExecuteAutoLaunchPods).not.toHaveBeenCalled();
    });

    it("should return 401 when CRON_SECRET is invalid", async () => {
      const request = new NextRequest("http://localhost:3000/api/cron/auto-launch-pods", {
        headers: {
          authorization: "Bearer invalid-secret",
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(mockExecuteAutoLaunchPods).not.toHaveBeenCalled();
    });

    it("should accept request with valid CRON_SECRET", async () => {
      process.env.AUTO_LAUNCH_PODS_ENABLED = "false";

      const request = new NextRequest("http://localhost:3000/api/cron/auto-launch-pods", {
        headers: {
          authorization: "Bearer test-cron-secret",
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("Feature Flag", () => {
    it("should return success with 0 processed when feature flag is disabled", async () => {
      process.env.AUTO_LAUNCH_PODS_ENABLED = "false";

      const request = new NextRequest("http://localhost:3000/api/cron/auto-launch-pods", {
        headers: {
          authorization: "Bearer test-cron-secret",
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Auto-launch pods cron is disabled",
        workspacesProcessed: 0,
        launchesTriggered: 0,
      });
      expect(mockExecuteAutoLaunchPods).not.toHaveBeenCalled();
    });

    it("should return success with 0 processed when feature flag is undefined", async () => {
      delete process.env.AUTO_LAUNCH_PODS_ENABLED;

      const request = new NextRequest("http://localhost:3000/api/cron/auto-launch-pods", {
        headers: {
          authorization: "Bearer test-cron-secret",
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Auto-launch pods cron is disabled",
        workspacesProcessed: 0,
        launchesTriggered: 0,
      });
      expect(mockExecuteAutoLaunchPods).not.toHaveBeenCalled();
    });

    it("should execute service when feature flag is enabled with 0 eligible workspaces", async () => {
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      mockExecuteAutoLaunchPods.mockResolvedValue({
        success: true,
        workspacesProcessed: 0,
        launchesTriggered: 0,
        errors: [],
        timestamp: new Date(),
      });

      const request = new NextRequest("http://localhost:3000/api/cron/auto-launch-pods", {
        headers: {
          authorization: "Bearer test-cron-secret",
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0);
      expect(data.launchesTriggered).toBe(0);
      expect(mockExecuteAutoLaunchPods).toHaveBeenCalledTimes(1);
    });

    it("should execute service when feature flag is enabled with eligible workspaces", async () => {
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      mockExecuteAutoLaunchPods.mockResolvedValue({
        success: true,
        workspacesProcessed: 2,
        launchesTriggered: 2,
        errors: [],
        timestamp: new Date(),
      });

      const request = new NextRequest("http://localhost:3000/api/cron/auto-launch-pods", {
        headers: {
          authorization: "Bearer test-cron-secret",
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(2);
      expect(data.launchesTriggered).toBe(2);
      expect(mockExecuteAutoLaunchPods).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling", () => {
    it("should handle service errors gracefully", async () => {
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      mockExecuteAutoLaunchPods.mockResolvedValue({
        success: false,
        workspacesProcessed: 1,
        launchesTriggered: 0,
        errors: [
          {
            workspaceSlug: "test-workspace",
            error: "Pool creation failed",
          },
        ],
        timestamp: new Date(),
      });

      const request = new NextRequest("http://localhost:3000/api/cron/auto-launch-pods", {
        headers: {
          authorization: "Bearer test-cron-secret",
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].workspaceSlug).toBe("test-workspace");
    });

    it("should return 500 on unhandled errors", async () => {
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      mockExecuteAutoLaunchPods.mockRejectedValue(
        new Error("Unexpected service error")
      );

      const request = new NextRequest("http://localhost:3000/api/cron/auto-launch-pods", {
        headers: {
          authorization: "Bearer test-cron-secret",
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Internal server error");
      expect(data.timestamp).toBeDefined();
    });
  });
});