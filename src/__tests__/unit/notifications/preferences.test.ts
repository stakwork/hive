import { describe, it, expect } from "vitest";
import { NotificationTriggerType } from "@prisma/client";
import {
  DEFAULT_NOTIFICATION_PREFS,
  isNotificationEnabled,
  getResolvedPreferences,
  validatePreferencesUpdate,
} from "@/lib/notifications/preferences";

describe("DEFAULT_NOTIFICATION_PREFS", () => {
  it("covers all 11 notification types", () => {
    const keys = Object.keys(DEFAULT_NOTIFICATION_PREFS);
    expect(keys).toHaveLength(11);
  });

  it("defaults GRAPH_CHAT_RESPONSE to false", () => {
    expect(DEFAULT_NOTIFICATION_PREFS.GRAPH_CHAT_RESPONSE).toBe(false);
  });

  it("defaults all other types to true", () => {
    const otherKeys = Object.keys(DEFAULT_NOTIFICATION_PREFS).filter(
      (k) => k !== "GRAPH_CHAT_RESPONSE"
    ) as NotificationTriggerType[];
    for (const key of otherKeys) {
      expect(DEFAULT_NOTIFICATION_PREFS[key]).toBe(true);
    }
  });
});

describe("isNotificationEnabled — backward-compat send gate", () => {
  it("returns true when stored is null", () => {
    expect(isNotificationEnabled(null, NotificationTriggerType.TASK_ASSIGNED)).toBe(true);
  });

  it("returns true when stored is undefined", () => {
    expect(isNotificationEnabled(undefined, NotificationTriggerType.TASK_ASSIGNED)).toBe(true);
  });

  it("returns true when stored is an empty object", () => {
    expect(isNotificationEnabled({}, NotificationTriggerType.TASK_ASSIGNED)).toBe(true);
  });

  it("returns true when stored is a non-object (string)", () => {
    expect(isNotificationEnabled("true", NotificationTriggerType.TASK_ASSIGNED)).toBe(true);
  });

  it("returns false when the type is explicitly false", () => {
    expect(
      isNotificationEnabled({ TASK_ASSIGNED: false }, NotificationTriggerType.TASK_ASSIGNED)
    ).toBe(false);
  });

  it("returns true when the type is explicitly true", () => {
    expect(
      isNotificationEnabled({ TASK_ASSIGNED: true }, NotificationTriggerType.TASK_ASSIGNED)
    ).toBe(true);
  });

  it("returns true for an unset key even when other keys are false", () => {
    expect(
      isNotificationEnabled(
        { TASK_ASSIGNED: false },
        NotificationTriggerType.FEATURE_ASSIGNED
      )
    ).toBe(true);
  });

  it("returns true when GRAPH_CHAT_RESPONSE is explicitly enabled by the user", () => {
    expect(
      isNotificationEnabled(
        { GRAPH_CHAT_RESPONSE: true },
        NotificationTriggerType.GRAPH_CHAT_RESPONSE
      )
    ).toBe(true);
  });

  it("returns true when GRAPH_CHAT_RESPONSE key is missing (backward-compat)", () => {
    expect(isNotificationEnabled({}, NotificationTriggerType.GRAPH_CHAT_RESPONSE)).toBe(true);
  });
});

describe("getResolvedPreferences — GET response merge", () => {
  it("returns all defaults when stored is null", () => {
    const result = getResolvedPreferences(null);
    expect(result).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("returns all defaults when stored is an empty object", () => {
    const result = getResolvedPreferences({});
    expect(result).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("overrides TASK_ASSIGNED when stored has it as false", () => {
    const result = getResolvedPreferences({ TASK_ASSIGNED: false });
    expect(result.TASK_ASSIGNED).toBe(false);
    // All other defaults unchanged
    expect(result.FEATURE_ASSIGNED).toBe(true);
    expect(result.GRAPH_CHAT_RESPONSE).toBe(false);
  });

  it("reflects GRAPH_CHAT_RESPONSE as true when user explicitly enables it", () => {
    const result = getResolvedPreferences({ GRAPH_CHAT_RESPONSE: true });
    expect(result.GRAPH_CHAT_RESPONSE).toBe(true);
  });

  it("preserves all other defaults when only one key is overridden", () => {
    const result = getResolvedPreferences({ WORKFLOW_HALTED: false });
    const expected = { ...DEFAULT_NOTIFICATION_PREFS, WORKFLOW_HALTED: false };
    expect(result).toEqual(expected);
  });

  it("ignores unknown keys in stored object", () => {
    const result = getResolvedPreferences({ UNKNOWN_TYPE: true });
    expect(result).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("returns all defaults when stored is a non-object", () => {
    expect(getResolvedPreferences("bad-value")).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(getResolvedPreferences(42)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

describe("validatePreferencesUpdate — PATCH validation", () => {
  it("accepts a valid single key update", () => {
    const result = validatePreferencesUpdate({ TASK_ASSIGNED: false });
    expect(result).toEqual({ TASK_ASSIGNED: false });
  });

  it("accepts multiple valid keys", () => {
    const result = validatePreferencesUpdate({
      TASK_ASSIGNED: false,
      FEATURE_ASSIGNED: true,
      GRAPH_CHAT_RESPONSE: true,
    });
    expect(result).toEqual({
      TASK_ASSIGNED: false,
      FEATURE_ASSIGNED: true,
      GRAPH_CHAT_RESPONSE: true,
    });
  });

  it("accepts an empty object (no-op update)", () => {
    const result = validatePreferencesUpdate({});
    expect(result).toEqual({});
  });

  it("throws for an invalid key", () => {
    expect(() => validatePreferencesUpdate({ INVALID_KEY: false })).toThrow(
      "Invalid notification type: INVALID_KEY"
    );
  });

  it("throws for a non-boolean value (string)", () => {
    expect(() => validatePreferencesUpdate({ TASK_ASSIGNED: "yes" })).toThrow(
      "Value for TASK_ASSIGNED must be a boolean"
    );
  });

  it("throws for a non-boolean value (number)", () => {
    expect(() => validatePreferencesUpdate({ TASK_ASSIGNED: 1 })).toThrow(
      "Value for TASK_ASSIGNED must be a boolean"
    );
  });

  it("throws for a null body", () => {
    expect(() => validatePreferencesUpdate(null)).toThrow("Body must be a JSON object");
  });

  it("throws for an array body", () => {
    expect(() => validatePreferencesUpdate([{ TASK_ASSIGNED: false }])).toThrow(
      "Body must be a JSON object"
    );
  });

  it("throws for a string body", () => {
    expect(() => validatePreferencesUpdate("TASK_ASSIGNED")).toThrow("Body must be a JSON object");
  });
});
