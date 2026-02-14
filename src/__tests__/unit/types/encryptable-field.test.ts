import { describe, it, expect } from "vitest";
import type { EncryptableField } from "@/types/encryption";

describe("EncryptableField Type", () => {
  it("should include lightningPubkey in EncryptableField union type", () => {
    // Type-level test: this will fail at compile time if lightningPubkey is not included
    const validFields: EncryptableField[] = [
      "access_token",
      "refresh_token",
      "id_token",
      "environmentVariables",
      "poolApiKey",
      "swarmApiKey",
      "swarmPassword",
      "stakworkApiKey",
      "githubWebhookSecret",
      "app_access_token",
      "app_refresh_token",
      "source_control_token",
      "source_control_refresh_token",
      "agentPassword",
      "agentWebhookSecret",
      "vercelApiToken",
      "vercelWebhookSecret",
      "sphinxBotSecret",
      "lightningPubkey",
    ];

    // Runtime verification that lightningPubkey is in the array
    expect(validFields).toContain("lightningPubkey");
  });

  it("should accept lightningPubkey as a valid EncryptableField", () => {
    const field: EncryptableField = "lightningPubkey";
    expect(field).toBe("lightningPubkey");
  });

  it("should maintain all existing encryptable fields", () => {
    const expectedFields: EncryptableField[] = [
      "access_token",
      "refresh_token",
      "id_token",
      "environmentVariables",
      "poolApiKey",
      "swarmApiKey",
      "swarmPassword",
      "stakworkApiKey",
      "githubWebhookSecret",
      "app_access_token",
      "app_refresh_token",
      "source_control_token",
      "source_control_refresh_token",
      "agentPassword",
      "agentWebhookSecret",
      "vercelApiToken",
      "vercelWebhookSecret",
      "sphinxBotSecret",
      "lightningPubkey",
    ];

    // Verify all fields are valid
    expectedFields.forEach((field) => {
      const testField: EncryptableField = field;
      expect(testField).toBe(field);
    });
  });
});
