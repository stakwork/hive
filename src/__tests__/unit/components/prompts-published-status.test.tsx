// @vitest-environment jsdom
import React from "react";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PromptsPanel } from "@/components/prompts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/w/test-workspace/prompts",
  useSearchParams: () => new URLSearchParams(),
}));

describe("PromptsPanel — isPublished derivation", () => {
  const basePrompt = {
    id: 1,
    name: "TEST_PROMPT",
    description: "desc",
    usage_notation: "{{PROMPT:TEST_PROMPT}}",
    usages: [],
  };

  const makeDetailResponse = (overrides: Record<string, unknown>) => ({
    success: true,
    data: {
      id: 1,
      name: "TEST_PROMPT",
      value: "some value",
      description: "desc",
      usage_notation: "{{PROMPT:TEST_PROMPT}}",
      current_version_id: null,
      published_version_id: null,
      version_count: 1,
      ...overrides,
    },
  });

  const setupFetch = (detailOverrides: Record<string, unknown>) => {
    global.fetch = vi.fn((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: { prompts: [basePrompt], total: 1, size: 10, page: 1 },
            }),
        } as Response);
      }
      if (urlStr.match(/\/api\/workflow\/prompts\/\d+$/)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeDetailResponse(detailOverrides)),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });
  };

  const renderAndSelectPrompt = async (detailOverrides: Record<string, unknown>) => {
    setupFetch(detailOverrides);
    render(<PromptsPanel />);
    await waitFor(() => screen.getByText("TEST_PROMPT"));
    screen.getByText("TEST_PROMPT").click();
    await waitFor(() => screen.getByText("Prompt Value"));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows Published badge when current_version_id === published_version_id (both non-null)", async () => {
    await renderAndSelectPrompt({ current_version_id: 5, published_version_id: 5 });
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.queryByText("Unpublished")).toBeNull();
  });

  test("shows Unpublished badge when current_version_id !== published_version_id", async () => {
    await renderAndSelectPrompt({ current_version_id: 3, published_version_id: 2 });
    expect(screen.getByText("Unpublished")).toBeTruthy();
    expect(screen.queryByText("Published")).toBeNull();
  });

  test("shows Publish button when unpublished", async () => {
    await renderAndSelectPrompt({ current_version_id: 3, published_version_id: 2 });
    const publishButtons = screen.getAllByRole("button", { name: /publish/i });
    expect(publishButtons.length).toBeGreaterThan(0);
  });

  test("does not show Publish button when published", async () => {
    await renderAndSelectPrompt({ current_version_id: 5, published_version_id: 5 });
    expect(screen.queryByRole("button", { name: /^publish$/i })).toBeNull();
  });

  test("shows Unpublished badge when both current_version_id and published_version_id are null", async () => {
    await renderAndSelectPrompt({ current_version_id: null, published_version_id: null });
    // null === null is true, but current_version_id must be non-null to be considered published
    expect(screen.getByText("Unpublished")).toBeTruthy();
  });

  test("shows Unpublished badge when published_version_id is null but current_version_id is set", async () => {
    await renderAndSelectPrompt({ current_version_id: 3, published_version_id: null });
    expect(screen.getByText("Unpublished")).toBeTruthy();
  });

  test("does not show Publish button in edit footer", async () => {
    await renderAndSelectPrompt({ current_version_id: 3, published_version_id: 2 });
    const editBtn = screen.getByRole("button", { name: /edit/i });
    editBtn.click();
    await waitFor(() => screen.getByText("Save Changes"));
    // Only Cancel and Save Changes should be in the footer — no Publish button
    expect(screen.queryByRole("button", { name: /^publish$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy();
  });
});
