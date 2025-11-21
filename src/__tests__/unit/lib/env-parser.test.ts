import { describe, it, expect } from "vitest";
import { parseEnv, validateEnvKey, formatEnvForExport } from "@/lib/env-parser";

describe("env-parser", () => {
  describe("parseEnv", () => {
    it("should parse simple key-value pairs", () => {
      const input = "KEY1=value1\nKEY2=value2";
      const result = parseEnv(input);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
      });
    });

    it("should skip empty lines", () => {
      const input = "KEY1=value1\n\nKEY2=value2\n\n";
      const result = parseEnv(input);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
      });
    });

    it("should skip comment lines", () => {
      const input = "# This is a comment\nKEY1=value1\n# Another comment\nKEY2=value2";
      const result = parseEnv(input);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
      });
    });

    it("should handle double-quoted values", () => {
      const input = 'KEY1="value with spaces"\nKEY2="value2"';
      const result = parseEnv(input);

      expect(result).toEqual({
        KEY1: "value with spaces",
        KEY2: "value2",
      });
    });

    it("should handle single-quoted values", () => {
      const input = "KEY1='value with spaces'\nKEY2='value2'";
      const result = parseEnv(input);

      expect(result).toEqual({
        KEY1: "value with spaces",
        KEY2: "value2",
      });
    });

    it("should handle unquoted values with special characters", () => {
      const input = "DATABASE_URL=postgresql://user:pass@localhost:5432/db\nAPI_KEY=abc123-def456";
      const result = parseEnv(input);

      expect(result).toEqual({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        API_KEY: "abc123-def456",
      });
    });

    it("should handle values with equals signs", () => {
      const input = "KEY1=value=with=equals";
      const result = parseEnv(input);

      expect(result).toEqual({
        KEY1: "value=with=equals",
      });
    });

    it("should skip lines without equals sign", () => {
      const input = "KEY1=value1\nINVALID_LINE\nKEY2=value2";
      const result = parseEnv(input);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
      });
    });

    it("should handle empty values", () => {
      const input = "KEY1=\nKEY2=value2";
      const result = parseEnv(input);

      expect(result).toEqual({
        KEY1: "",
        KEY2: "value2",
      });
    });

    it("should trim whitespace around keys and values", () => {
      const input = "  KEY1  =  value1  \n  KEY2=value2";
      const result = parseEnv(input);

      expect(result).toEqual({
        KEY1: "value1",
        KEY2: "value2",
      });
    });

    it("should handle mixed content", () => {
      const input = `
# Database configuration
DATABASE_URL="postgresql://localhost:5432/db"

# API keys
API_KEY=abc123
SECRET_KEY='very-secret'

# Empty value
OPTIONAL_KEY=
      `.trim();

      const result = parseEnv(input);

      expect(result).toEqual({
        DATABASE_URL: "postgresql://localhost:5432/db",
        API_KEY: "abc123",
        SECRET_KEY: "very-secret",
        OPTIONAL_KEY: "",
      });
    });

    it("should return empty object for empty input", () => {
      const result = parseEnv("");
      expect(result).toEqual({});
    });

    it("should return empty object for only comments", () => {
      const input = "# Comment 1\n# Comment 2";
      const result = parseEnv(input);
      expect(result).toEqual({});
    });
  });

  describe("validateEnvKey", () => {
    it("should validate keys starting with letters", () => {
      expect(validateEnvKey("API_KEY")).toBe(true);
      expect(validateEnvKey("DATABASE_URL")).toBe(true);
      expect(validateEnvKey("NODE_ENV")).toBe(true);
    });

    it("should validate keys starting with underscore", () => {
      expect(validateEnvKey("_PRIVATE_KEY")).toBe(true);
    });

    it("should validate keys with numbers", () => {
      expect(validateEnvKey("API_KEY_2")).toBe(true);
      expect(validateEnvKey("KEY123")).toBe(true);
    });

    it("should reject keys starting with numbers", () => {
      expect(validateEnvKey("123KEY")).toBe(false);
    });

    it("should reject keys with hyphens", () => {
      expect(validateEnvKey("API-KEY")).toBe(false);
    });

    it("should reject keys with spaces", () => {
      expect(validateEnvKey("API KEY")).toBe(false);
    });

    it("should reject keys with special characters", () => {
      expect(validateEnvKey("API@KEY")).toBe(false);
      expect(validateEnvKey("API.KEY")).toBe(false);
      expect(validateEnvKey("API$KEY")).toBe(false);
    });

    it("should reject empty keys", () => {
      expect(validateEnvKey("")).toBe(false);
    });

    it("should accept keys with only underscores", () => {
      expect(validateEnvKey("___")).toBe(true);
    });
  });

  describe("formatEnvForExport", () => {
    it("should format simple key-value pairs", () => {
      const vars = {
        KEY1: "value1",
        KEY2: "value2",
      };
      const result = formatEnvForExport(vars);

      expect(result).toBe("KEY1=value1\nKEY2=value2");
    });

    it("should quote values with spaces", () => {
      const vars = {
        KEY1: "value with spaces",
      };
      const result = formatEnvForExport(vars);

      expect(result).toBe('KEY1="value with spaces"');
    });

    it("should quote values with newlines", () => {
      const vars = {
        KEY1: "line1\nline2",
      };
      const result = formatEnvForExport(vars);

      expect(result).toBe('KEY1="line1\nline2"');
    });

    it("should escape double quotes in values", () => {
      const vars = {
        KEY1: 'value with "quotes"',
      };
      const result = formatEnvForExport(vars);

      expect(result).toBe('KEY1="value with \\"quotes\\""');
    });

    it("should not quote simple values", () => {
      const vars = {
        DATABASE_URL: "postgresql://localhost:5432/db",
        API_KEY: "abc123-def456",
      };
      const result = formatEnvForExport(vars);

      expect(result).toBe("DATABASE_URL=postgresql://localhost:5432/db\nAPI_KEY=abc123-def456");
    });

    it("should handle empty values", () => {
      const vars = {
        KEY1: "",
        KEY2: "value",
      };
      const result = formatEnvForExport(vars);

      expect(result).toBe("KEY1=\nKEY2=value");
    });

    it("should handle empty object", () => {
      const result = formatEnvForExport({});
      expect(result).toBe("");
    });

    it("should handle mixed content", () => {
      const vars = {
        SIMPLE: "value",
        WITH_SPACES: "value with spaces",
        WITH_QUOTES: 'has "quotes"',
        EMPTY: "",
      };
      const result = formatEnvForExport(vars);

      expect(result).toContain("SIMPLE=value");
      expect(result).toContain('WITH_SPACES="value with spaces"');
      expect(result).toContain('WITH_QUOTES="has \\"quotes\\""');
      expect(result).toContain("EMPTY=");
    });
  });
});
