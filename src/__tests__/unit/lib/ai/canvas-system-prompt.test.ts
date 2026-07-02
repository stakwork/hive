import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
}));

vi.mock("@/lib/constants/prompt", () => ({
  DEFAULT_CANVAS_SYSTEM_PROMPT: "DEFAULT_PROMPT_TEXT",
}));

vi.mock("@/services/prompts/prompt-read", () => ({
  getResolvedPrompt: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { isDevelopmentMode } from "@/lib/runtime";
import { getResolvedPrompt } from "@/services/prompts/prompt-read";

const mockIsDev = isDevelopmentMode as ReturnType<typeof vi.fn>;
const mockGetResolvedPrompt = getResolvedPrompt as ReturnType<typeof vi.fn>;

// Reset module & globalThis cache between tests so each test starts fresh.
async function importFresh() {
  // Clear globalThis cache anchor used by the module.
  (globalThis as Record<string, unknown>).__canvasSystemPromptCache = undefined;

  vi.resetModules();
  const mod = await import("@/lib/ai/canvas-system-prompt");
  return mod;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getCanvasSystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDev.mockReturnValue(false);
    (globalThis as Record<string, unknown>).__canvasSystemPromptCache = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the resolved prompt with Hive string ids on success", async () => {
    mockGetResolvedPrompt.mockResolvedValueOnce({
      id: "clprompt001",
      name: "CANVAS_AGENT_SYSTEM_PROMPT",
      versionId: "clversion001",
      versionNumber: 1,
      resolvedText: "You are a canvas agent.",
      missingVariables: [],
    });

    const { getCanvasSystemPrompt } = await importFresh();
    const result = await getCanvasSystemPrompt();

    expect(result.value).toBe("You are a canvas agent.");
    expect(result.name).toBe("CANVAS_AGENT_SYSTEM_PROMPT");
    expect(result.promptId).toBe("clprompt001");
    expect(result.promptVersionId).toBe("clversion001");
    expect(mockGetResolvedPrompt).toHaveBeenCalledWith("CANVAS_AGENT_SYSTEM_PROMPT", {});
  });

  it("falls back to DEFAULT_CANVAS_SYSTEM_PROMPT when prompt is notFound", async () => {
    mockGetResolvedPrompt.mockResolvedValueOnce({ notFound: true });

    const { getCanvasSystemPrompt } = await importFresh();
    const result = await getCanvasSystemPrompt();

    expect(result.value).toBe("DEFAULT_PROMPT_TEXT");
    expect(result.promptId).toBeNull();
    expect(result.promptVersionId).toBeNull();
  });

  it("falls back to DEFAULT_CANVAS_SYSTEM_PROMPT on error result", async () => {
    mockGetResolvedPrompt.mockResolvedValueOnce({ error: "DB connection failed" });

    const { getCanvasSystemPrompt } = await importFresh();
    const result = await getCanvasSystemPrompt();

    expect(result.value).toBe("DEFAULT_PROMPT_TEXT");
    expect(result.promptId).toBeNull();
    expect(result.promptVersionId).toBeNull();
  });

  it("falls back to DEFAULT_CANVAS_SYSTEM_PROMPT when getResolvedPrompt throws", async () => {
    mockGetResolvedPrompt.mockRejectedValueOnce(new Error("Network failure"));

    const { getCanvasSystemPrompt } = await importFresh();
    const result = await getCanvasSystemPrompt();

    expect(result.value).toBe("DEFAULT_PROMPT_TEXT");
    expect(result.promptId).toBeNull();
  });

  it("returns default in dev mode without calling getResolvedPrompt", async () => {
    mockIsDev.mockReturnValue(true);

    const { getCanvasSystemPrompt } = await importFresh();
    const result = await getCanvasSystemPrompt();

    expect(result.value).toBe("DEFAULT_PROMPT_TEXT");
    expect(result.promptId).toBeNull();
    expect(mockGetResolvedPrompt).not.toHaveBeenCalled();
  });

  it("caches a successful result and does not call getResolvedPrompt again", async () => {
    mockGetResolvedPrompt.mockResolvedValue({
      id: "clprompt001",
      name: "CANVAS_AGENT_SYSTEM_PROMPT",
      versionId: "clversion001",
      versionNumber: 1,
      resolvedText: "Cached prompt text",
      missingVariables: [],
    });

    const { getCanvasSystemPrompt } = await importFresh();

    const first = await getCanvasSystemPrompt();
    const second = await getCanvasSystemPrompt();

    expect(first.value).toBe("Cached prompt text");
    expect(second.value).toBe("Cached prompt text");
    // Only one DB hit despite two calls
    expect(mockGetResolvedPrompt).toHaveBeenCalledTimes(1);
  });

  it("caches a fallback result briefly after notFound", async () => {
    mockGetResolvedPrompt.mockResolvedValue({ notFound: true });

    const { getCanvasSystemPrompt } = await importFresh();

    const first = await getCanvasSystemPrompt();
    const second = await getCanvasSystemPrompt();

    expect(first.value).toBe("DEFAULT_PROMPT_TEXT");
    expect(second.value).toBe("DEFAULT_PROMPT_TEXT");
    // Fallback is cached — only one DB lookup
    expect(mockGetResolvedPrompt).toHaveBeenCalledTimes(1);
  });
});
