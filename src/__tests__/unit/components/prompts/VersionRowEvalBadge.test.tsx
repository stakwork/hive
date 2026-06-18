/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptsPanel } from "@/components/prompts";

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/w/test-workspace/prompts",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Pusher (no-op in unit tests)
vi.mock("@/lib/pusher", () => ({
  getPusherClient: () => ({
    subscribe: () => ({ bind: vi.fn(), unbind: vi.fn(), unbind_all: vi.fn() }),
    unsubscribe: vi.fn(),
  }),
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: { PROMPT_EVAL_RESULT: "prompt-eval-result" },
}));

const CURRENT_VERSION_SENTINEL = -1;

const mockPrompt = {
  id: 1,
  name: "TEST_PROMPT",
  value: "some value",
  description: "desc",
  usage_notation: "{{PROMPT:TEST_PROMPT}}",
  current_version_id: 3,
  published_version_id: null,
  version_count: 3,
  usages: [],
};

const mockVersions = [
  { id: 1, version_number: 1, created_at: "2024-01-01T00:00:00Z", whodunnit: null },
  { id: 2, version_number: 2, created_at: "2024-01-02T00:00:00Z", whodunnit: null },
];

/** Helper: build a fetch mock that routes requests appropriately */
function buildFetch(evalRunsByVersionId: Record<number, object | null> = {}) {
  return vi.fn((url: unknown) => {
    const u = String(url);

    // Prompt list
    if (u.includes("/api/workflow/prompts?")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          data: { prompts: [{ ...mockPrompt }], total: 1, size: 10, page: 1 },
        }),
      });
    }
    // Prompt detail
    if (u.match(/\/api\/workflow\/prompts\/\d+$/) && !u.includes("/versions")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: mockPrompt }),
      });
    }
    // Version list
    if (u.includes("/versions") && !u.includes("/versions/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { versions: mockVersions } }),
      });
    }
    // Eval run GET — /versions/[id]/run-evals
    const evalRunMatch = u.match(/\/versions\/(\d+)\/run-evals/);
    if (evalRunMatch) {
      const vId = parseInt(evalRunMatch[1], 10);
      const run = evalRunsByVersionId[vId] ?? null;
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: run }),
      });
    }
    // Version content
    if (u.match(/\/versions\/\d+$/)) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { value: "version content", description: "" } }),
      });
    }

    return Promise.resolve({ ok: true, json: async () => ({}) });
  }) as unknown as typeof fetch;
}

/** Navigate to history view: click a prompt, then click View History */
async function navigateToHistory() {
  const promptButton = await screen.findByText("TEST_PROMPT");
  await userEvent.click(promptButton);
  const historyButton = await screen.findByText(/View History/i);
  await userEvent.click(historyButton);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Version row eval run UI", () => {
  it("shows Play button when no eval run exists for a historical version", async () => {
    global.fetch = buildFetch({});

    render(<PromptsPanel workspaceSlug="test-workspace" />);
    await navigateToHistory();

    // Wait for versions to render
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());

    // Play buttons should exist (one per historical version + Current)
    const playButtons = screen.getAllByTitle(/Run evals on/i);
    expect(playButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Loader2 spinner when status is IN_PROGRESS", async () => {
    global.fetch = buildFetch({
      // version id=1's eval run is IN_PROGRESS
      1: { id: "run-abc", status: "IN_PROGRESS", result: null, evalSetId: "es-1" },
    });

    render(<PromptsPanel workspaceSlug="test-workspace" />);
    await navigateToHistory();

    // Wait for history to populate
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());

    // spinner should appear
    await waitFor(() => {
      const spinners = document.querySelectorAll(".animate-spin");
      expect(spinners.length).toBeGreaterThan(0);
    });
  });

  it("shows green badge '8/10 pass' when all pass (fail === 0)", async () => {
    global.fetch = buildFetch({
      1: { id: "run-1", status: "COMPLETED", result: '{"pass":8,"fail":0,"total":10}', evalSetId: "es-1" },
    });

    render(<PromptsPanel workspaceSlug="test-workspace" />);
    await navigateToHistory();

    await waitFor(() => {
      expect(screen.getByText("8/10 pass")).toBeInTheDocument();
    });

    const badge = screen.getByText("8/10 pass");
    expect(badge.className).toMatch(/bg-green/);
  });

  it("shows red badge '7/10 pass' when some fail", async () => {
    global.fetch = buildFetch({
      1: { id: "run-2", status: "COMPLETED", result: '{"pass":7,"fail":3,"total":10}', evalSetId: "es-1" },
    });

    render(<PromptsPanel workspaceSlug="test-workspace" />);
    await navigateToHistory();

    await waitFor(() => {
      expect(screen.getByText("7/10 pass")).toBeInTheDocument();
    });

    const badge = screen.getByText("7/10 pass");
    expect(badge.className).toMatch(/bg-red/);
  });
});
