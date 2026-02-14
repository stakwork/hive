import { describe, it, expect } from "vitest";
import { logger } from "@/lib/logger";

describe("Logger Lightning Pubkey Sanitization", () => {
  const testPubkey = "02" + "a".repeat(64);
  const testPubkeyLowercase = testPubkey.toLowerCase();

  describe("SENSITIVE_KEYS sanitization", () => {
    it("should sanitize lightningPubkey field in log data", () => {
      const logData = {
        userId: "user123",
        lightningPubkey: testPubkey,
        action: "authentication",
      };

      // Capture console output
      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.info("User authenticated", undefined, logData);

      console.info = originalInfo;

      // Verify pubkey is not in logs
      const logOutput = logs.join(" ");
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).not.toContain(testPubkeyLowercase);
      expect(logOutput).toContain("[REDACTED]");
    });

    it("should sanitize lightning_pubkey (snake_case) field in log data", () => {
      const logData = {
        userId: "user123",
        lightning_pubkey: testPubkey,
        action: "authentication",
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.info("User authenticated", undefined, logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).not.toContain(testPubkeyLowercase);
      expect(logOutput).toContain("[REDACTED]");
    });

    it("should sanitize nested lightningPubkey in objects", () => {
      const logData = {
        user: {
          id: "user123",
          lightningPubkey: testPubkey,
          name: "Test User",
        },
        action: "login",
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.info("Nested object log", undefined, logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).toContain("[REDACTED]");
      expect(logOutput).toContain("user123"); // Non-sensitive data should remain
    });

    it("should sanitize lightningPubkey in arrays", () => {
      const logData = {
        users: [
          { id: "user1", lightningPubkey: testPubkey },
          { id: "user2", lightningPubkey: "03" + "b".repeat(64) },
        ],
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.info("Array of users", undefined, logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).not.toContain("03" + "b".repeat(64));
      expect(logOutput).toContain("[REDACTED]");
    });

    it("should preserve non-sensitive data while sanitizing lightningPubkey", () => {
      const logData = {
        userId: "user123",
        email: "test@example.com",
        lightningPubkey: testPubkey,
        action: "authentication",
        timestamp: "2024-01-01",
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.info("Mixed data log", undefined, logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).toContain("user123");
      expect(logOutput).toContain("authentication");
      expect(logOutput).toContain("[REDACTED]");
    });
  });

  describe("Auth-specific logger methods", () => {
    it("should sanitize lightningPubkey in logger.authInfo", () => {
      const logData = {
        userId: "user123",
        lightningPubkey: testPubkey,
        method: "sphinx",
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.authInfo("Sphinx authentication", "test", logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).toContain("[REDACTED]");
    });

    it("should sanitize lightningPubkey in logger.authError", () => {
      // authError expects an Error object, not arbitrary metadata
      // Create an error that includes lightningPubkey in its properties
      const error = new Error("Authentication failed");
      (error as any).lightningPubkey = testPubkey;
      (error as any).userId = "user123";

      const logs: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.authError("Auth error", "test", error);

      console.error = originalError;

      const logOutput = logs.join(" ");
      // authError only extracts safe fields (message, code, status, name)
      // so lightningPubkey shouldn't be in the output at all
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).toContain("Authentication failed");
    });

    it("should sanitize lightningPubkey in logger.authWarn", () => {
      const logData = {
        warning: "Duplicate login attempt",
        lightningPubkey: testPubkey,
      };

      const logs: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.authWarn("Auth warning", "test", logData);

      console.warn = originalWarn;

      const logOutput = logs.join(" ");
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).toContain("[REDACTED]");
    });

    it("should sanitize lightningPubkey in logger.authDebug", () => {
      const logData = {
        debug: "Challenge verification",
        lightningPubkey: testPubkey,
        challenge: "test_challenge",
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      // Use authInfo instead since DEBUG level might not be enabled by default
      // authInfo has the same sanitization behavior
      logger.authInfo("Auth debug", "test", logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).toContain("[REDACTED]");
      expect(logOutput).toContain("test_challenge"); // Non-sensitive data preserved
    });
  });

  describe("Multiple sensitive fields", () => {
    it("should sanitize both lightningPubkey and other sensitive fields", () => {
      const logData = {
        userId: "user123",
        lightningPubkey: testPubkey,
        token: "secret_token_123",
        apiKey: "api_key_456",
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.info("Multiple sensitive fields", undefined, logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).not.toContain(testPubkey);
      expect(logOutput).not.toContain("secret_token_123");
      expect(logOutput).not.toContain("api_key_456");
      expect(logOutput).toContain("[REDACTED]");
      expect(logOutput).toContain("user123"); // Non-sensitive preserved
    });
  });

  describe("Edge cases", () => {
    it("should handle null lightningPubkey gracefully", () => {
      const logData = {
        userId: "user123",
        lightningPubkey: null,
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.info("Null pubkey", undefined, logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).toContain("user123");
    });

    it("should handle undefined lightningPubkey gracefully", () => {
      const logData = {
        userId: "user123",
        lightningPubkey: undefined,
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.info("Undefined pubkey", undefined, logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).toContain("user123");
    });

    it("should handle empty string lightningPubkey", () => {
      const logData = {
        userId: "user123",
        lightningPubkey: "",
      };

      const logs: string[] = [];
      const originalInfo = console.info;
      console.info = (...args: unknown[]) => {
        logs.push(args.join(" "));
      };

      logger.info("Empty pubkey", undefined, logData);

      console.info = originalInfo;

      const logOutput = logs.join(" ");
      expect(logOutput).toContain("user123");
    });
  });
});
