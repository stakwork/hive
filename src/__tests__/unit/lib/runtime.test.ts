import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isDevelopmentMode, isSwarmFakeModeEnabled } from "@/lib/runtime";

describe("runtime utilities", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    // Store original NODE_ENV value
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    // Restore original NODE_ENV value
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    vi.clearAllMocks();
  });

  describe("isDevelopmentMode", () => {
    it("should return true when NODE_ENV is development", () => {
      process.env.NODE_ENV = "development";

      expect(isDevelopmentMode()).toBe(true);
    });

    it("should return false when NODE_ENV is production", () => {
      process.env.NODE_ENV = "production";

      expect(isDevelopmentMode()).toBe(false);
    });

    it("should return false when NODE_ENV is test", () => {
      process.env.NODE_ENV = "test";

      expect(isDevelopmentMode()).toBe(false);
    });

    it("should return false when NODE_ENV is staging", () => {
      process.env.NODE_ENV = "staging";

      expect(isDevelopmentMode()).toBe(false);
    });

    it("should return false when NODE_ENV is undefined", () => {
      delete process.env.NODE_ENV;

      expect(isDevelopmentMode()).toBe(false);
    });

    it("should return false when NODE_ENV is empty string", () => {
      process.env.NODE_ENV = "";

      expect(isDevelopmentMode()).toBe(false);
    });

    it("should return false when NODE_ENV has different casing", () => {
      process.env.NODE_ENV = "DEVELOPMENT";

      expect(isDevelopmentMode()).toBe(false);
    });

    it("should return false when NODE_ENV has whitespace", () => {
      process.env.NODE_ENV = " development ";

      expect(isDevelopmentMode()).toBe(false);
    });
  });

  describe("isSwarmFakeModeEnabled", () => {
    it("should return true when NODE_ENV is development", () => {
      process.env.NODE_ENV = "development";

      expect(isSwarmFakeModeEnabled()).toBe(true);
    });

    it("should return false when NODE_ENV is production", () => {
      process.env.NODE_ENV = "production";

      expect(isSwarmFakeModeEnabled()).toBe(false);
    });

    it("should return false when NODE_ENV is test", () => {
      process.env.NODE_ENV = "test";

      expect(isSwarmFakeModeEnabled()).toBe(false);
    });

    it("should return false when NODE_ENV is staging", () => {
      process.env.NODE_ENV = "staging";

      expect(isSwarmFakeModeEnabled()).toBe(false);
    });

    it("should return false when NODE_ENV is undefined", () => {
      delete process.env.NODE_ENV;

      expect(isSwarmFakeModeEnabled()).toBe(false);
    });

    it("should return false when NODE_ENV is empty string", () => {
      process.env.NODE_ENV = "";

      expect(isSwarmFakeModeEnabled()).toBe(false);
    });

    it("should have the same behavior as isDevelopmentMode", () => {
      const testCases = ["development", "production", "test", "staging", "", undefined];

      testCases.forEach((nodeEnv) => {
        if (nodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = nodeEnv;
        }

        expect(isSwarmFakeModeEnabled()).toBe(isDevelopmentMode());
      });
    });
  });

  describe("function integration", () => {
    it("should maintain consistent behavior between both functions", () => {
      const environments = ["development", "production", "test", "staging", ""];

      environments.forEach((env) => {
        process.env.NODE_ENV = env;

        const isDev = isDevelopmentMode();
        const isSwarmFake = isSwarmFakeModeEnabled();

        expect(isSwarmFake).toBe(isDev);
        expect(typeof isDev).toBe("boolean");
        expect(typeof isSwarmFake).toBe("boolean");
      });
    });

    it("should handle rapid environment changes correctly", () => {
      // Test rapid switching between environments
      process.env.NODE_ENV = "development";
      expect(isDevelopmentMode()).toBe(true);
      expect(isSwarmFakeModeEnabled()).toBe(true);

      process.env.NODE_ENV = "production";
      expect(isDevelopmentMode()).toBe(false);
      expect(isSwarmFakeModeEnabled()).toBe(false);

      process.env.NODE_ENV = "development";
      expect(isDevelopmentMode()).toBe(true);
      expect(isSwarmFakeModeEnabled()).toBe(true);
    });
  });
});
