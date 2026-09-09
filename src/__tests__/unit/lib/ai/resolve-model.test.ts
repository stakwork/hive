import { describe, test, expect, vi, beforeEach } from "vitest";

const mockLlmModelFindFirst = vi.fn();
const mockUserUpdate = vi.fn();
const mockFeatureUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    llmModel: { findFirst: (...args: unknown[]) => mockLlmModelFindFirst(...args) },
    user: { update: (...args: unknown[]) => mockUserUpdate(...args) },
    feature: { update: (...args: unknown[]) => mockFeatureUpdate(...args) },
  },
}));

import { resolveModelAgainstCatalog, healFeatureModel, healUserChatAgentModel } from "@/lib/ai/resolve-model";

const xaiRow = { id: "m1", name: "grok-4.6", provider: "XAI", providerLabel: null, isPlanDefault: false, isTaskDefault: false };
const openrouterRow = { id: "m2", name: "x-ai/grok-4.6", provider: "OTHER", providerLabel: "OpenRouter", isPlanDefault: false, isTaskDefault: false };

describe("resolveModelAgainstCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  test("empty input resolves to null without touching the catalog", async () => {
    expect(await resolveModelAgainstCatalog(null)).toEqual({ value: null, healed: false });
    expect(await resolveModelAgainstCatalog(undefined)).toEqual({ value: null, healed: false });
    expect(mockLlmModelFindFirst).not.toHaveBeenCalled();
  });

  test("short aliases pass through unchanged", async () => {
    expect(await resolveModelAgainstCatalog("sonnet")).toEqual({ value: "sonnet", healed: false });
    expect(mockLlmModelFindFirst).not.toHaveBeenCalled();
  });

  test("a value that matches its live row is returned unchanged", async () => {
    mockLlmModelFindFirst.mockResolvedValue(xaiRow);
    expect(await resolveModelAgainstCatalog("xai/grok-4.6")).toEqual({ value: "xai/grok-4.6", healed: false });
    expect(mockLlmModelFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ name: "grok-4.6", isPublic: true }) }),
    );
  });

  test("a stale prefix heals to the provider that owns the name today", async () => {
    mockLlmModelFindFirst.mockResolvedValue(xaiRow);
    expect(await resolveModelAgainstCatalog("grok4.6/grok-4.6")).toEqual({ value: "xai/grok-4.6", healed: true });
  });

  test("OpenRouter names containing slashes look up the full tail", async () => {
    mockLlmModelFindFirst.mockResolvedValue(openrouterRow);
    expect(await resolveModelAgainstCatalog("openrouter/x-ai/grok-4.6")).toEqual({
      value: "openrouter/x-ai/grok-4.6",
      healed: false,
    });
    expect(mockLlmModelFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ name: "x-ai/grok-4.6" }) }),
    );
  });

  test("no live row → null", async () => {
    mockLlmModelFindFirst.mockResolvedValue(null);
    expect(await resolveModelAgainstCatalog("openrouter/grok-4")).toEqual({ value: null, healed: false });
  });

  test("catalog lookup failure fails open with the stored value", async () => {
    mockLlmModelFindFirst.mockRejectedValue(new Error("db down"));
    expect(await resolveModelAgainstCatalog("xai/grok-4.6")).toEqual({ value: "xai/grok-4.6", healed: false });
  });
});

describe("healUserChatAgentModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  test("persists the healed value", async () => {
    mockLlmModelFindFirst.mockResolvedValue(xaiRow);
    mockUserUpdate.mockResolvedValue({});
    expect(await healUserChatAgentModel("u1", "grok4.6/grok-4.6")).toBe("xai/grok-4.6");
    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { chatAgentModel: "xai/grok-4.6" } });
  });

  test("does not write when the value is current or unresolvable", async () => {
    mockLlmModelFindFirst.mockResolvedValueOnce(xaiRow).mockResolvedValueOnce(null);
    expect(await healUserChatAgentModel("u1", "xai/grok-4.6")).toBe("xai/grok-4.6");
    expect(await healUserChatAgentModel("u1", "openrouter/grok-4")).toBeUndefined();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

describe("healFeatureModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("persists the healed value on the feature", async () => {
    mockLlmModelFindFirst.mockResolvedValue(xaiRow);
    mockFeatureUpdate.mockResolvedValue({});
    expect(await healFeatureModel("f1", "grok4.6/grok-4.6")).toBe("xai/grok-4.6");
    expect(mockFeatureUpdate).toHaveBeenCalledWith({ where: { id: "f1" }, data: { model: "xai/grok-4.6" } });
  });

  test("null feature model is a no-op", async () => {
    expect(await healFeatureModel("f1", null)).toBeUndefined();
    expect(mockLlmModelFindFirst).not.toHaveBeenCalled();
    expect(mockFeatureUpdate).not.toHaveBeenCalled();
  });
});
