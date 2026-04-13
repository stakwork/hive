import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { isValidModel, getApiKeyForModel, VALID_MODELS, PROVIDER_API_KEY_ENV_VARS } from "@/lib/ai/models";

describe("models", () => {
  describe("isValidModel", () => {
    test("returns true for all valid models", () => {
      for (const model of VALID_MODELS) {
        expect(isValidModel(model)).toBe(true);
      }
    });

    test("returns true for haiku", () => {
      expect(isValidModel("haiku")).toBe(true);
    });

    test("returns false for unknown model", () => {
      expect(isValidModel("unknown-model")).toBe(false);
    });

    test("returns false for non-string values", () => {
      expect(isValidModel(null)).toBe(false);
      expect(isValidModel(undefined)).toBe(false);
      expect(isValidModel(42)).toBe(false);
    });
  });

  describe("getApiKeyForModel", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test("returns ANTHROPIC_API_KEY for haiku", () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      expect(getApiKeyForModel("haiku")).toBe("test-anthropic-key");
    });

    test("returns ANTHROPIC_API_KEY for sonnet", () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      expect(getApiKeyForModel("sonnet")).toBe("test-anthropic-key");
    });

    test("returns OPENAI_API_KEY for gpt", () => {
      process.env.OPENAI_API_KEY = "test-openai-key";
      expect(getApiKeyForModel("gpt")).toBe("test-openai-key");
    });

    test("returns undefined when env var is not set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(getApiKeyForModel("haiku")).toBeUndefined();
    });

    test("returns ANTHROPIC_API_KEY for provider/name format (anthropic/...)", () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      expect(getApiKeyForModel("anthropic/claude-sonnet-4-6")).toBe("test-anthropic-key");
    });

    test("returns OPENAI_API_KEY for provider/name format (openai/...)", () => {
      process.env.OPENAI_API_KEY = "test-openai-key";
      expect(getApiKeyForModel("openai/gpt-4o")).toBe("test-openai-key");
    });

    test("returns GOOGLE_API_KEY for provider/name format (google/...)", () => {
      process.env.GOOGLE_API_KEY = "test-google-key";
      expect(getApiKeyForModel("google/gemini-pro")).toBe("test-google-key");
    });

    test("returns undefined for other/custom (OTHER maps to null)", () => {
      expect(getApiKeyForModel("other/custom-model")).toBeUndefined();
    });

    test("returns undefined for unknown provider in provider/name format", () => {
      expect(getApiKeyForModel("unknown/some-model")).toBeUndefined();
    });

    test("alias format still works for gpt", () => {
      process.env.OPENAI_API_KEY = "test-openai-key";
      expect(getApiKeyForModel("gpt")).toBe("test-openai-key");
    });

    test("alias format still works for gemini", () => {
      process.env.GOOGLE_API_KEY = "test-google-key";
      expect(getApiKeyForModel("gemini")).toBe("test-google-key");
    });
  });

  describe("PROVIDER_API_KEY_ENV_VARS", () => {
    test("maps ANTHROPIC to ANTHROPIC_API_KEY", () => {
      expect(PROVIDER_API_KEY_ENV_VARS["ANTHROPIC"]).toBe("ANTHROPIC_API_KEY");
    });

    test("maps OPENAI to OPENAI_API_KEY", () => {
      expect(PROVIDER_API_KEY_ENV_VARS["OPENAI"]).toBe("OPENAI_API_KEY");
    });

    test("maps GOOGLE to GOOGLE_API_KEY", () => {
      expect(PROVIDER_API_KEY_ENV_VARS["GOOGLE"]).toBe("GOOGLE_API_KEY");
    });

    test("maps OTHER to null", () => {
      expect(PROVIDER_API_KEY_ENV_VARS["OTHER"]).toBeNull();
    });
  });
});
