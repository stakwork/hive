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

// Mutable Pusher mock so individual tests can capture bind handlers
let capturedPusherHandler: ((data: unknown) => void) | null = null;

vi.mock("@/lib/pusher", () => ({
  getPusherClient: () => ({
    subscribe: () => ({
      bind: vi.fn((event: string, handler: (data: unknown) => void) => {
        if (event === "prompt-eval-result") {
          capturedPusherHandler = handler;
        }
      }),
      unbind: vi.fn(),
      unbind_all: vi.fn(),
    }),
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
  capturedPusherHandler = null;
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

  it("maps Pusher promptVersionId to CURRENT_VERSION_SENTINEL for the current version", async () => {
    // No pre-existing eval runs
    global.fetch = buildFetch({});

    render(<PromptsPanel workspaceSlug="test-workspace" />);
    await navigateToHistory();

    // Wait for version list to render so Pusher effect has fired
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());

    // Simulate Pusher event with the real DB id (3 = current_version_id)
    expect(capturedPusherHandler).not.toBeNull();
    capturedPusherHandler!({
      runId: "r1",
      promptVersionId: 3, // matches mockPrompt.current_version_id
      result: { pass: 4, fail: 0, total: 4 },
    });

    // The Current row should now show the green badge
    await waitFor(() => {
      expect(screen.getByText("4/4 pass")).toBeInTheDocument();
    });
    const badge = screen.getByText("4/4 pass");
    expect(badge.className).toMatch(/bg-green/);

    // No badge should appear under a raw numeric key of 3 — only the Current row renders it
    // (The "Current" label is the sentinel row, not a "v3" row)
    expect(screen.queryByText("v3")).not.toBeInTheDocument();
  });

  it("shows expandable history toggle and list when multiple runs exist", async () => {
    const run1 = { id: "run-a", status: "COMPLETED", result: '{"pass":5,"fail":0,"total":5}', evalSetId: "es-set-1", createdAt: "2024-01-10T12:00:00Z" };
    const run2 = { id: "run-b", status: "COMPLETED", result: '{"pass":3,"fail":2,"total":5}', evalSetId: "es-set-2", createdAt: "2024-01-09T08:00:00Z" };

    // Override fetch to return history for version 1
    const mockFetch = vi.fn((url: unknown) => {
      const u = String(url);

      if (u.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { prompts: [{ ...mockPrompt }], total: 1, size: 10, page: 1 },
          }),
        });
      }
      if (u.match(/\/api\/workflow\/prompts\/\d+$/) && !u.includes("/versions")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: mockPrompt }),
        });
      }
      if (u.includes("/versions") && !u.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { versions: mockVersions } }),
        });
      }
      // Eval run GET — returns both data and history for version 1
      const evalRunMatch = u.match(/\/versions\/(\d+)\/run-evals/);
      if (evalRunMatch) {
        const vId = parseInt(evalRunMatch[1], 10);
        if (vId === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, data: run1, history: [run1, run2] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: null, history: [] }),
        });
      }
      if (u.match(/\/versions\/\d+$/)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { value: "version content", description: "" } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;

    global.fetch = mockFetch;

    render(<PromptsPanel workspaceSlug="test-workspace" />);
    await navigateToHistory();

    // Wait for v1 to appear
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());

    // Chevron toggle button should be visible for v1 (title="Toggle eval run history")
    await waitFor(() => {
      expect(screen.getByTitle("Toggle eval run history")).toBeInTheDocument();
    });

    // Click the toggle to expand
    const toggleBtn = screen.getByTitle("Toggle eval run history");
    await userEvent.click(toggleBtn);

    // Two history entries should now be visible (timestamps from createdAt)
    await waitFor(() => {
      const entries = screen.getAllByText(/2024/);
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });

    // The second history entry (3/5 pass — red) should appear in the expanded list
    await waitFor(() => {
      expect(screen.getByText("3/5 pass")).toBeInTheDocument();
    });
    const redBadge = screen.getByText("3/5 pass");
    expect(redBadge.className).toMatch(/bg-red/);
  });
});
