import { describe, it, expect, afterEach } from "vitest";
import { isPromptsCapabilityEnabledForOrgLogin } from "@/config/env";

describe("isPromptsCapabilityEnabledForOrgLogin", () => {
  const original = process.env.PROMPTS_CAPABILITY_ORG_LOGINS;

  afterEach(() => {
    if (original !== undefined) {
      process.env.PROMPTS_CAPABILITY_ORG_LOGINS = original;
    } else {
      delete process.env.PROMPTS_CAPABILITY_ORG_LOGINS;
    }
  });

  describe("default (unset env)", () => {
    it("defaults to the stakwork org only", () => {
      delete process.env.PROMPTS_CAPABILITY_ORG_LOGINS;
      expect(isPromptsCapabilityEnabledForOrgLogin("stakwork")).toBe(true);
      expect(isPromptsCapabilityEnabledForOrgLogin("STAKWORK")).toBe(true);
      expect(isPromptsCapabilityEnabledForOrgLogin("some-other-org")).toBe(false);
    });

    it("also defaults to stakwork when env is empty string", () => {
      process.env.PROMPTS_CAPABILITY_ORG_LOGINS = "";
      expect(isPromptsCapabilityEnabledForOrgLogin("stakwork")).toBe(true);
      expect(isPromptsCapabilityEnabledForOrgLogin("acme")).toBe(false);
    });
  });

  describe("fails closed on empty/missing login", () => {
    it("returns false for empty / null / undefined login", () => {
      delete process.env.PROMPTS_CAPABILITY_ORG_LOGINS;
      expect(isPromptsCapabilityEnabledForOrgLogin("")).toBe(false);
      expect(isPromptsCapabilityEnabledForOrgLogin("   ")).toBe(false);
      expect(isPromptsCapabilityEnabledForOrgLogin(null)).toBe(false);
      expect(isPromptsCapabilityEnabledForOrgLogin(undefined)).toBe(false);
    });
  });

  describe("CSV allow-list (future multi-org)", () => {
    it("matches any listed org, case-insensitively, trimmed", () => {
      process.env.PROMPTS_CAPABILITY_ORG_LOGINS = " stakwork , Acme ";
      expect(isPromptsCapabilityEnabledForOrgLogin("stakwork")).toBe(true);
      expect(isPromptsCapabilityEnabledForOrgLogin("acme")).toBe(true);
      expect(isPromptsCapabilityEnabledForOrgLogin("ACME")).toBe(true);
      expect(isPromptsCapabilityEnabledForOrgLogin("other")).toBe(false);
    });

    it("does not do substring matching", () => {
      process.env.PROMPTS_CAPABILITY_ORG_LOGINS = "stakwork";
      expect(isPromptsCapabilityEnabledForOrgLogin("stakworkx")).toBe(false);
      expect(isPromptsCapabilityEnabledForOrgLogin("stak")).toBe(false);
    });
  });
});
