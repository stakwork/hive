import { describe, it, expect } from "vitest";

describe("Deployment Status Mapping", () => {
  describe("status mapping", () => {
    const mapDeploymentStatus = (state: string): "IN_PROGRESS" | "SUCCESS" | "FAILURE" | "ERROR" | null => {
      if (state === "success") {
        return "SUCCESS";
      } else if (state === "failure") {
        return "FAILURE";
      } else if (state === "error") {
        return "ERROR";
      } else if (state === "pending" || state === "in_progress") {
        return "IN_PROGRESS";
      }
      return null;
    };

    it("should map 'success' to SUCCESS", () => {
      expect(mapDeploymentStatus("success")).toBe("SUCCESS");
    });

    it("should map 'failure' to FAILURE", () => {
      expect(mapDeploymentStatus("failure")).toBe("FAILURE");
    });

    it("should map 'error' to ERROR", () => {
      expect(mapDeploymentStatus("error")).toBe("ERROR");
    });

    it("should map 'pending' to IN_PROGRESS", () => {
      expect(mapDeploymentStatus("pending")).toBe("IN_PROGRESS");
    });

    it("should map 'in_progress' to IN_PROGRESS", () => {
      expect(mapDeploymentStatus("in_progress")).toBe("IN_PROGRESS");
    });

    it("should return null for unknown status", () => {
      expect(mapDeploymentStatus("unknown")).toBeNull();
      expect(mapDeploymentStatus("queued")).toBeNull();
      expect(mapDeploymentStatus("cancelled")).toBeNull();
    });
  });

  describe("environment filtering", () => {
    const isTrackedEnvironment = (environment: string): boolean => {
      const normalized = environment.toLowerCase();
      return normalized === "staging" || normalized === "production";
    };

    it("should accept 'staging' environment", () => {
      expect(isTrackedEnvironment("staging")).toBe(true);
      expect(isTrackedEnvironment("Staging")).toBe(true);
      expect(isTrackedEnvironment("STAGING")).toBe(true);
    });

    it("should accept 'production' environment", () => {
      expect(isTrackedEnvironment("production")).toBe(true);
      expect(isTrackedEnvironment("Production")).toBe(true);
      expect(isTrackedEnvironment("PRODUCTION")).toBe(true);
    });

    it("should reject non-tracked environments", () => {
      expect(isTrackedEnvironment("qa")).toBe(false);
      expect(isTrackedEnvironment("dev")).toBe(false);
      expect(isTrackedEnvironment("development")).toBe(false);
      expect(isTrackedEnvironment("canary")).toBe(false);
      expect(isTrackedEnvironment("preview")).toBe(false);
      expect(isTrackedEnvironment("testing")).toBe(false);
      expect(isTrackedEnvironment("uat")).toBe(false);
    });

    it("should reject empty or invalid environments", () => {
      expect(isTrackedEnvironment("")).toBe(false);
      expect(isTrackedEnvironment("  ")).toBe(false);
    });
  });

  describe("environment to prisma enum mapping", () => {
    const mapEnvironmentToEnum = (environment: string): "STAGING" | "PRODUCTION" | null => {
      const normalized = environment.toLowerCase();
      if (normalized === "staging") return "STAGING";
      if (normalized === "production") return "PRODUCTION";
      return null;
    };

    it("should map staging to STAGING enum", () => {
      expect(mapEnvironmentToEnum("staging")).toBe("STAGING");
      expect(mapEnvironmentToEnum("Staging")).toBe("STAGING");
      expect(mapEnvironmentToEnum("STAGING")).toBe("STAGING");
    });

    it("should map production to PRODUCTION enum", () => {
      expect(mapEnvironmentToEnum("production")).toBe("PRODUCTION");
      expect(mapEnvironmentToEnum("Production")).toBe("PRODUCTION");
      expect(mapEnvironmentToEnum("PRODUCTION")).toBe("PRODUCTION");
    });

    it("should return null for non-tracked environments", () => {
      expect(mapEnvironmentToEnum("qa")).toBeNull();
      expect(mapEnvironmentToEnum("dev")).toBeNull();
      expect(mapEnvironmentToEnum("canary")).toBeNull();
    });
  });

  describe("completed timestamp logic", () => {
    const shouldSetCompletedAt = (status: string): boolean => {
      return status === "SUCCESS" || status === "FAILURE" || status === "ERROR";
    };

    it("should set completedAt for terminal states", () => {
      expect(shouldSetCompletedAt("SUCCESS")).toBe(true);
      expect(shouldSetCompletedAt("FAILURE")).toBe(true);
      expect(shouldSetCompletedAt("ERROR")).toBe(true);
    });

    it("should not set completedAt for in-progress states", () => {
      expect(shouldSetCompletedAt("IN_PROGRESS")).toBe(false);
    });
  });

  describe("task status update logic", () => {
    const shouldUpdateTaskStatus = (mappedStatus: string): boolean => {
      return mappedStatus === "SUCCESS";
    };

    it("should update task status only for SUCCESS", () => {
      expect(shouldUpdateTaskStatus("SUCCESS")).toBe(true);
    });

    it("should not update task status for non-SUCCESS states", () => {
      expect(shouldUpdateTaskStatus("FAILURE")).toBe(false);
      expect(shouldUpdateTaskStatus("ERROR")).toBe(false);
      expect(shouldUpdateTaskStatus("IN_PROGRESS")).toBe(false);
    });
  });

  describe("deployment url extraction", () => {
    const extractDeploymentUrl = (payload: {
      target_url?: string;
      environment_url?: string;
    }): string | null => {
      return payload.target_url || payload.environment_url || null;
    };

    it("should prefer target_url over environment_url", () => {
      const payload = {
        target_url: "https://target.example.com",
        environment_url: "https://env.example.com",
      };
      expect(extractDeploymentUrl(payload)).toBe("https://target.example.com");
    });

    it("should fallback to environment_url if target_url missing", () => {
      const payload = {
        environment_url: "https://env.example.com",
      };
      expect(extractDeploymentUrl(payload)).toBe("https://env.example.com");
    });

    it("should return null if both urls missing", () => {
      const payload = {};
      expect(extractDeploymentUrl(payload)).toBeNull();
    });

    it("should return null if urls are empty strings", () => {
      const payload = {
        target_url: "",
        environment_url: "",
      };
      expect(extractDeploymentUrl(payload)).toBeNull();
    });
  });
});
