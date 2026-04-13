import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { isValidModel, getApiKeyForModel, VALID_MODELS } from "@/lib/ai/models";

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
  });
});
