import React from "react";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PromptsPanel } from "@/components/prompts";

// Sentinel ID for representing the current live version
const CURRENT_VERSION_SENTINEL = -1;

// Mock Next.js router hooks
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/w/test-workspace/prompts",
  useSearchParams: () => new URLSearchParams(),
}));

describe("PromptsPanel - Version History", () => {
  const mockPromptWithHistory = {
    id: 1,
    name: "Test Prompt",
    value: "Original prompt value",
    description: "Test description",
    usage_notation: "{{PROMPT:TEST_PROMPT}}",
    current_version_id: 3,
    version_count: 3,
  };

  const mockPromptWithoutHistory = {
    id: 2,
    name: "New Prompt",
    value: "New prompt value",
    description: "New description",
    usage_notation: "{{PROMPT:NEW_PROMPT}}",
    current_version_id: 1,
    version_count: 1,
  };

  const mockVersions = [
    { id: 1, version_number: 1, created_at: "2024-01-01T10:00:00Z", whodunnit: "user1" },
    { id: 2, version_number: 2, created_at: "2024-01-02T10:00:00Z", whodunnit: "user2" },
    { id: 3, version_number: 3, created_at: "2024-01-03T10:00:00Z", whodunnit: null },
  ];

  const mockVersionContent = {
    1: "First version of prompt",
    2: "Second version with changes",
    3: "Third version with more changes",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  test("History button is visible when version_count > 1", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    await waitFor(() => {
      expect(getByText(/View History/i)).toBeInTheDocument();
    });

    const historyButton = getByText(/View History \(3 versions\)/i);
    expect(historyButton).toBeInTheDocument();
  });

  test("History button is hidden when version_count <= 1", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithoutHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithoutHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithoutHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, queryByText } = render(<PromptsPanel />);

    const promptButton = await findByText("New Prompt");
    fireEvent.click(promptButton);

    await waitFor(() => {
      expect(queryByText(/View History/i)).not.toBeInTheDocument();
    });
  });

  test("Clicking History button loads and displays version list", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes("/versions") && !url.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompt_id: mockPromptWithHistory.id,
              prompt_name: mockPromptWithHistory.name,
              versions: mockVersions,
              current_version_id: mockPromptWithHistory.current_version_id,
              version_count: mockPromptWithHistory.version_count,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    const historyButton = await findByText(/View History/i);
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(getByText("v1")).toBeInTheDocument();
      expect(getByText("v2")).toBeInTheDocument();
      expect(getByText("v3")).toBeInTheDocument();
    });

    expect(getByText(/Version History/i)).toBeInTheDocument();
  });

  test("Version selection state transitions correctly", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes("/versions") && !url.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              versions: mockVersions,
              current_version_id: 3,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    const historyButton = await findByText(/View History/i);
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(getByText("v1")).toBeInTheDocument();
    });

    // Click v3 to select as A
    const v3Button = getByText("v3").closest("button");
    fireEvent.click(v3Button!);

    await waitFor(() => {
      expect(v3Button).toHaveClass("bg-blue-100");
    });

    // Click v1 to select as B
    const v1Button = getByText("v1").closest("button");
    fireEvent.click(v1Button!);

    await waitFor(() => {
      expect(v1Button).toHaveClass("bg-green-100");
    });
  });

  test("Diff renders with mocked version content", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes("/versions/1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              version_id: 1,
              version_number: 1,
              value: mockVersionContent[1],
              created_at: "2024-01-01T10:00:00Z",
            },
          }),
        });
      }
      if (url.includes("/versions/3")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              version_id: 3,
              version_number: 3,
              value: mockVersionContent[3],
              created_at: "2024-01-03T10:00:00Z",
            },
          }),
        });
      }
      if (url.includes("/versions") && !url.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              versions: mockVersions,
              current_version_id: 3,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    const historyButton = await findByText(/View History/i);
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(getByText("v1")).toBeInTheDocument();
    });

    // Click v3 to select as A
    const v3Button = getByText("v3").closest("button");
    fireEvent.click(v3Button!);

    // Click v1 to select as B
    const v1Button = getByText("v1").closest("button");
    fireEvent.click(v1Button!);

    // Wait for diff to load and render
    await waitFor(() => {
      expect(getByText("Changes")).toBeInTheDocument();
    });

    // Check that content appears in the diff view
    await waitFor(() => {
      const diffContent = document.body.textContent || "";
      expect(diffContent).toContain("First version");
      expect(diffContent).toContain("Third version");
    });
  });

  test("Back button returns to detail view", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes("/versions") && !url.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              versions: mockVersions,
              current_version_id: 3,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText, queryByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    const historyButton = await findByText(/View History/i);
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(getByText(/Version History/i)).toBeInTheDocument();
    });

    // Click back button
    const backButtons = document.querySelectorAll("button");
    const backButton = Array.from(backButtons).find(
      (btn) => btn.textContent?.includes("Back")
    );
    fireEvent.click(backButton!);

    // Should return to detail view
    await waitFor(() => {
      expect(queryByText(/Version History/i)).not.toBeInTheDocument();
      expect(getByText(/Usage Notation/i)).toBeInTheDocument();
    });
  });

  // New tests for "Current" version functionality
  test("Current version button appears at top of version list", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes("/versions") && !url.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              versions: mockVersions,
              current_version_id: 3,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    const historyButton = await findByText(/View History/i);
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(getByText("Current")).toBeInTheDocument();
      expect(getByText("Live")).toBeInTheDocument();
    });

    // Verify Current appears before historical versions
    const versionButtons = document.querySelectorAll("button");
    const buttonTexts = Array.from(versionButtons).map((btn) => btn.textContent || "");
    const currentIndex = buttonTexts.findIndex((text) => text.includes("Current"));
    const v1Index = buttonTexts.findIndex((text) => text.includes("v1"));
    
    expect(currentIndex).toBeGreaterThan(-1);
    expect(v1Index).toBeGreaterThan(-1);
    expect(currentIndex).toBeLessThan(v1Index);
  });

  test("Current version button appears even with no historical versions", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes("/versions") && !url.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              versions: [], // No historical versions
              current_version_id: 1,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    const historyButton = await findByText(/View History/i);
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(getByText("Current")).toBeInTheDocument();
      expect(getByText("No previous versions")).toBeInTheDocument();
    });
  });

  test("Current version participates in A/B selection flow", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes("/versions") && !url.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              versions: mockVersions,
              current_version_id: 3,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    const historyButton = await findByText(/View History/i);
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(getByText("Current")).toBeInTheDocument();
    });

    // Click Current to select as A
    const currentButton = getByText("Current").closest("button");
    fireEvent.click(currentButton!);

    await waitFor(() => {
      expect(currentButton).toHaveClass("bg-blue-100");
    });

    // Click v1 to select as B
    const v1Button = getByText("v1").closest("button");
    fireEvent.click(v1Button!);

    await waitFor(() => {
      expect(v1Button).toHaveClass("bg-green-100");
    });
  });

  test("Sentinel short-circuit: no API call when Current is selected", async () => {
    const fetchSpy = vi.fn();
    
    global.fetch = vi.fn((url) => {
      fetchSpy(url);
      
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes("/versions/1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              version_id: 1,
              version_number: 1,
              value: mockVersionContent[1],
              created_at: "2024-01-01T10:00:00Z",
            },
          }),
        });
      }
      if (url.includes("/versions") && !url.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              versions: mockVersions,
              current_version_id: 3,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    const historyButton = await findByText(/View History/i);
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(getByText("Current")).toBeInTheDocument();
    });

    // Select Current as A
    const currentButton = getByText("Current").closest("button");
    fireEvent.click(currentButton!);

    // Select v1 as B
    const v1Button = getByText("v1").closest("button");
    fireEvent.click(v1Button!);

    // Wait for diff to load
    await waitFor(() => {
      expect(getByText("Changes")).toBeInTheDocument();
    });

    // Verify that fetchVersionContent was called only once (for v1, not for Current)
    const versionContentCalls = fetchSpy.mock.calls.filter((call: any) => 
      String(call[0]).includes("/versions/") && !String(call[0]).endsWith("/versions")
    );
    
    expect(versionContentCalls.length).toBe(1);
    expect(String(versionContentCalls[0][0])).toContain("/versions/1");
  });

  test("Diff renders correctly when Current is one side", async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes("/api/workflow/prompts?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              prompts: [mockPromptWithHistory],
              total: 1,
              size: 10,
              page: 1,
            },
          }),
        });
      }
      if (url.includes("/versions/1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              version_id: 1,
              version_number: 1,
              value: mockVersionContent[1],
              created_at: "2024-01-01T10:00:00Z",
            },
          }),
        });
      }
      if (url.includes("/versions") && !url.includes("/versions/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              versions: mockVersions,
              current_version_id: 3,
            },
          }),
        });
      }
      if (url.includes(`/api/workflow/prompts/${mockPromptWithHistory.id}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: mockPromptWithHistory,
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    }) as any;

    const { findByText, getByText } = render(<PromptsPanel />);

    const promptButton = await findByText("Test Prompt");
    fireEvent.click(promptButton);

    const historyButton = await findByText(/View History/i);
    fireEvent.click(historyButton);

    await waitFor(() => {
      expect(getByText("Current")).toBeInTheDocument();
    });

    // Select Current as A
    const currentButton = getByText("Current").closest("button");
    fireEvent.click(currentButton!);

    // Select v1 as B
    const v1Button = getByText("v1").closest("button");
    fireEvent.click(v1Button!);

    // Wait for diff to render
    await waitFor(() => {
      expect(getByText("Changes")).toBeInTheDocument();
    });

    // Check that both the current value and v1 content appear in diff
    await waitFor(() => {
      const diffContent = document.body.textContent || "";
      expect(diffContent).toContain("Original prompt value"); // Current version
      expect(diffContent).toContain("First version"); // v1 content
    });
  });
});
