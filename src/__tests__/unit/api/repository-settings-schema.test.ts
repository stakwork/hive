import { describe, test, expect } from "vitest";
import { z } from "zod";

// Replicate the schema here so it can be tested in isolation without importing
// the full route (which pulls in server-only modules).
const blobSizeLimitSchema = z
  .string()
  .regex(/^[1-9][0-9]*[kmg]?$/i, {
    message: "Size must be a positive number optionally followed by k, m, or g (e.g. 1m, 500k)",
  })
  .max(20, "Size limit value is too long")
  .or(z.literal(""));

const repositorySettingsSchema = z.object({
  codeIngestionEnabled: z.boolean().optional(),
  docsEnabled: z.boolean().optional(),
  mocksEnabled: z.boolean().optional(),
  embeddingsEnabled: z.boolean().optional(),
  triggerPodRepair: z.boolean().optional(),
  shallowClone: z.boolean().optional(),
  blobSizeLimit: blobSizeLimitSchema.optional(),
});

describe("repositorySettingsSchema – blobSizeLimit validation", () => {
  describe("valid values", () => {
    test.each(["1m", "500k", "2g", "1", "100", "1024k", "1024m"])(
      "accepts '%s'",
      (value) => {
        const result = repositorySettingsSchema.safeParse({ blobSizeLimit: value });
        expect(result.success).toBe(true);
      }
    );

    test("accepts empty string (clearing the value)", () => {
      const result = repositorySettingsSchema.safeParse({ blobSizeLimit: "" });
      expect(result.success).toBe(true);
    });

    test("accepts undefined (field omitted)", () => {
      const result = repositorySettingsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test("case-insensitive suffix (1M, 500K, 2G)", () => {
      for (const value of ["1M", "500K", "2G"]) {
        const result = repositorySettingsSchema.safeParse({ blobSizeLimit: value });
        expect(result.success, `${value} should be valid`).toBe(true);
      }
    });
  });

  describe("invalid values", () => {
    test.each(["abc", "0", "0m", "m", "1x", " 1m", "1m ", "-1m"])(
      "rejects '%s'",
      (value) => {
        const result = repositorySettingsSchema.safeParse({ blobSizeLimit: value });
        expect(result.success).toBe(false);
      }
    );

    test("rejects bare '0' (semantically invalid git filter)", () => {
      const result = repositorySettingsSchema.safeParse({ blobSizeLimit: "0" });
      expect(result.success).toBe(false);
    });

    test("rejects overly long string", () => {
      const result = repositorySettingsSchema.safeParse({
        blobSizeLimit: "1" + "0".repeat(20) + "m",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("shallowClone validation", () => {
    test("accepts true", () => {
      const result = repositorySettingsSchema.safeParse({ shallowClone: true });
      expect(result.success).toBe(true);
    });

    test("accepts false", () => {
      const result = repositorySettingsSchema.safeParse({ shallowClone: false });
      expect(result.success).toBe(true);
    });

    test("accepts undefined (field omitted)", () => {
      const result = repositorySettingsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test("rejects non-boolean", () => {
      const result = repositorySettingsSchema.safeParse({ shallowClone: "true" });
      expect(result.success).toBe(false);
    });
  });

  describe("combined payload", () => {
    test("accepts shallowClone + valid blobSizeLimit together", () => {
      const result = repositorySettingsSchema.safeParse({
        shallowClone: true,
        blobSizeLimit: "1m",
      });
      expect(result.success).toBe(true);
    });

    test("accepts all existing fields alongside new ones", () => {
      const result = repositorySettingsSchema.safeParse({
        codeIngestionEnabled: true,
        docsEnabled: false,
        mocksEnabled: false,
        embeddingsEnabled: true,
        triggerPodRepair: false,
        shallowClone: true,
        blobSizeLimit: "500k",
      });
      expect(result.success).toBe(true);
    });
  });
});
