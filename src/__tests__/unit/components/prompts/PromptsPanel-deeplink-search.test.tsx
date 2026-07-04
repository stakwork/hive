/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { PromptsPanel } from "@/components/prompts";

// ─── Mutable search params (set per-test before render) ──────────────────────

let mockSearchParamsStore: Record<string, string> = {};

const mockRouterReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockRouterReplace,
    prefetch: vi.fn(),
  }),
  usePathname: () => "/w/test-workspace/prompts",
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsStore[key] ?? null,
    toString: () => new URLSearchParams(mockSearchParamsStore).toString(),
  }),
}));

vi.mock("@/hooks/useUserTimezone", () => ({
  useUserTimezone: () => ({ timezone: "UTC" }),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: () => ({
    subscribe: () => ({ bind: vi.fn(), unbind: vi.fn() }),
    unsubscribe: vi.fn(),
  }),
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: { PROMPT_EVAL_RESULT: "prompt_eval_result" },
}));

vi.mock("@/services/bifrost/agent-names", () => ({
  BIFROST_AGENT_NAMES: ["agent-a", "agent-b"],
}));

// ─── Test Data ────────────────────────────────────────────────────────────────

const PROMPT_CUID = "cmr23zujs006oyj4gkk9hntvi";
const VERSION_CUID = "cmr23zujs006oyj4gkk9hntv2";

const mockPromptDetail = {
  id: PROMPT_CUID,
  name: "MY_PROMPT",
  value: "Hello world prompt",
  description: "A test prompt",
  usage_notation: "{{PROMPT:MY_PROMPT}}",
  agent_names: [],
  current_version_id: VERSION_CUID,
  published_version_id: VERSION_CUID,
  version_count: 2,
};

const mockVersionsList = [
  { id: "cmr23zujs006oyj4gkk9hntv1", version_number: 1, created_at: "2024-01-01T10:00:00Z", whodunnit: null },
  { id: VERSION_CUID, version_number: 2, created_at: "2024-01-02T10:00:00Z", whodunnit: null },
];

const mockVersionContent = "Version 2 content here";

function makeListFetch() {
  return Promise.resolve({
    ok: true,
    json: async () => ({
      success: true,
      data: { prompts: [], total: 0, size: 10, page: 1 },
    }),
  });
}

function makeDetailFetch() {
  return Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data: mockPromptDetail }),
  });
}

function makeVersionsFetch() {
  return Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data: { versions: mockVersionsList } }),
  });
}

function makeVersionContentFetch() {
  return Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data: { value: mockVersionContent } }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PromptsPanel – deep-link (cuid IDs)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsStore = {};
  });

  it("opens detail view when ?prompt=<cuid> is in the URL", async () => {
    mockSearchParamsStore = { prompt: PROMPT_CUID };

    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/workflow/prompts?")) return makeListFetch();
      if (url.includes(`/api/workflow/prompts/${PROMPT_CUID}`)) return makeDetailFetch();
      return makeListFetch();
    }) as unknown as typeof fetch;

    render(<PromptsPanel variant="fullpage" workspaceSlug="test-workspace" />);

    // fetchPromptDetail is called with the string cuid
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/workflow/prompts/${PROMPT_CUID}`)
      );
    });

    // The prompt name should appear in the detail view header
    await waitFor(() => {
      expect(screen.getByText("MY_PROMPT")).toBeInTheDocument();
    });
  });

  it("opens history view with version selected when ?prompt=<cuid>&version=<cuid> is in the URL", async () => {
    mockSearchParamsStore = { prompt: PROMPT_CUID, version: VERSION_CUID };

    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/workflow/prompts?")) return makeListFetch();
      if (url.includes(`/api/workflow/prompts/${PROMPT_CUID}/versions/${VERSION_CUID}`)) {
        return makeVersionContentFetch();
      }
      if (url.includes(`/api/workflow/prompts/${PROMPT_CUID}/versions`)) {
        return makeVersionsFetch();
      }
      if (url.includes(`/api/workflow/prompts/${PROMPT_CUID}`)) return makeDetailFetch();
      return makeListFetch();
    }) as unknown as typeof fetch;

    render(<PromptsPanel variant="fullpage" workspaceSlug="test-workspace" />);

    // fetchVersionList should be called
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]: [string]) => url);
      expect(calls.some((u: string) => u.includes(`/api/workflow/prompts/${PROMPT_CUID}/versions`))).toBe(true);
    });

    // Version history heading should appear
    await waitFor(() => {
      expect(screen.getByText(/Version History/i)).toBeInTheDocument();
    });
  });

  it("gracefully falls back to list view when ?prompt param is missing", async () => {
    mockSearchParamsStore = {};

    global.fetch = vi.fn(() => makeListFetch()) as unknown as typeof fetch;

    render(<PromptsPanel variant="fullpage" workspaceSlug="test-workspace" />);

    // Should NOT call the detail endpoint
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]: [string]) => url);
      expect(calls.some((u: string) => u.includes(`/api/workflow/prompts/${PROMPT_CUID}`))).toBe(false);
    });
  });

  it("does not crash when ?prompt param is an invalid/unknown cuid (API returns 404)", async () => {
    const INVALID_ID = "totally-invalid-id";
    mockSearchParamsStore = { prompt: INVALID_ID };

    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/workflow/prompts?")) return makeListFetch();
      if (url.includes(`/api/workflow/prompts/${INVALID_ID}`)) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ success: false, error: "Not found" }),
        });
      }
      return makeListFetch();
    }) as unknown as typeof fetch;

    // Should render without throwing
    expect(() =>
      render(<PromptsPanel variant="fullpage" workspaceSlug="test-workspace" />)
    ).not.toThrow();

    // The detail fetch is attempted with the string id
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/workflow/prompts/${INVALID_ID}`)
      );
    });
  });
});

describe("PromptsPanel – search debouncing (no per-keystroke router.replace)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsStore = {};
  });

  it("fires exactly one search fetch ~300ms after the last keystroke, not per keystroke", async () => {
    global.fetch = vi.fn(() => makeListFetch()) as unknown as typeof fetch;

    render(<PromptsPanel variant="fullpage" workspaceSlug="test-workspace" />);

    // Wait for initial load to complete and search input to appear
    const searchInput = await screen.findByPlaceholderText(/search prompts/i, {}, { timeout: 3000 });

    const initialFetchCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    // Simulate typing "test" rapidly — each fires handleSearchChange but no router.replace yet
    fireEvent.change(searchInput, { target: { value: "t" } });
    fireEvent.change(searchInput, { target: { value: "te" } });
    fireEvent.change(searchInput, { target: { value: "tes" } });
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Immediately after typing: no search fetch should have fired yet (debounce hasn't settled)
    const midSearchFetches = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .slice(initialFetchCount)
      .filter(([url]: [string]) => url.includes("search="));
    expect(midSearchFetches).toHaveLength(0);

    // Wait for the debounce to settle (300ms + buffer)
    await waitFor(
      () => {
        const searchFetches = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
          .slice(initialFetchCount)
          .filter(([url]: [string]) => url.includes("search="));
        expect(searchFetches).toHaveLength(1);
        expect(searchFetches[0][0]).toContain("search=test");
      },
      { timeout: 2000 }
    );
  }, 10000);

  it("does not call router.replace per keystroke — only once after debounce settles", async () => {
    global.fetch = vi.fn(() => makeListFetch()) as unknown as typeof fetch;

    render(<PromptsPanel variant="fullpage" workspaceSlug="test-workspace" />);

    // Wait for initial load
    const searchInput = await screen.findByPlaceholderText(/search prompts/i, {}, { timeout: 3000 });

    mockRouterReplace.mockClear();

    // Simulate typing 3 characters rapidly
    fireEvent.change(searchInput, { target: { value: "a" } });
    fireEvent.change(searchInput, { target: { value: "ab" } });
    fireEvent.change(searchInput, { target: { value: "abc" } });

    // router.replace should NOT have been called for any individual keystroke
    expect(mockRouterReplace).not.toHaveBeenCalled();

    // After debounce settles (~300ms), router.replace should fire exactly ONCE
    await waitFor(
      () => {
        expect(mockRouterReplace).toHaveBeenCalledTimes(1);
        expect(mockRouterReplace).toHaveBeenCalledWith(
          expect.stringContaining("search=abc"),
          expect.anything()
        );
      },
      { timeout: 2000 }
    );
  }, 10000);
});
