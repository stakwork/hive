/**
 * Unit tests for `lib/ai/jamieEngine.ts` — the org-level engine switch.
 * The default path must stay the default: anything but a stored "strut"
 * reads as "hive", and so does every failure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindUnique } = vi.hoisted(() => ({ mockFindUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { sourceControlOrg: { findUnique: mockFindUnique } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { DEFAULT_JAMIE_ENGINE, isJamieEngine, jamieEngineForOrg, parseJamieEngine } from "@/lib/ai/jamieEngine";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseJamieEngine / isJamieEngine", () => {
  it("knows the two engines and nothing else", () => {
    expect(parseJamieEngine("hive")).toBe("hive");
    expect(parseJamieEngine("strut")).toBe("strut");
    expect(parseJamieEngine("STRUT")).toBe("hive");
    expect(parseJamieEngine(null)).toBe("hive");
    expect(parseJamieEngine(undefined)).toBe("hive");
    expect(parseJamieEngine(1)).toBe("hive");
    expect(DEFAULT_JAMIE_ENGINE).toBe("hive");
    expect(isJamieEngine("strut")).toBe(true);
    expect(isJamieEngine("")).toBe(false);
    expect(isJamieEngine("jamie")).toBe(false);
  });
});

describe("jamieEngineForOrg", () => {
  it("reads the org's column", async () => {
    mockFindUnique.mockResolvedValue({ jamieEngine: "strut" });
    expect(await jamieEngineForOrg("org-1")).toBe("strut");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "org-1" }, select: { jamieEngine: true } });
  });

  it("is hive for the stored default, an unknown value, a missing org, no org id, or a failed lookup", async () => {
    mockFindUnique.mockResolvedValue({ jamieEngine: "hive" });
    expect(await jamieEngineForOrg("org-1")).toBe("hive");
    mockFindUnique.mockResolvedValue({ jamieEngine: "something-else" });
    expect(await jamieEngineForOrg("org-1")).toBe("hive");
    mockFindUnique.mockResolvedValue(null);
    expect(await jamieEngineForOrg("org-1")).toBe("hive");
    expect(await jamieEngineForOrg(undefined)).toBe("hive");
    expect(await jamieEngineForOrg(null)).toBe("hive");
    mockFindUnique.mockRejectedValue(new Error("db down"));
    expect(await jamieEngineForOrg("org-1")).toBe("hive");
  });
});
