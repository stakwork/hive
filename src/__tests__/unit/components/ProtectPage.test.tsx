/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const mockUseWorkspace = vi.fn();
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

const mockUseWorkspaceAccess = vi.fn();
vi.mock("@/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => mockUseWorkspaceAccess(),
}));

vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => true,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

vi.mock("@/components/protect/FindingsList", () => ({
  FindingsList: () => <div data-testid="findings-list" />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <div data-testid="select" data-value={value}>
      <button type="button" data-testid="select-change" onClick={() => onValueChange?.("openai/gpt-4o")}>
        change
      </button>
      {children}
    </div>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { "data-testid"?: string }) => (
    <div data-testid={props["data-testid"] ?? "select-trigger"}>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

import ProtectPage from "@/app/w/[slug]/protect/page";

const MODELS = [
  {
    id: "1",
    name: "claude-sonnet-4",
    provider: "ANTHROPIC",
    providerLabel: "Anthropic",
    isPlanDefault: false,
    isTaskDefault: true,
  },
  {
    id: "2",
    name: "gpt-4o",
    provider: "OPENAI",
    providerLabel: "OpenAI",
    isPlanDefault: false,
    isTaskDefault: false,
  },
];

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => body,
  });
}

describe("ProtectPage model picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({
      workspace: { slug: "acme", id: "ws-1" },
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/llm-models") {
        return jsonResponse({ models: MODELS });
      }
      if (typeof url === "string" && url.endsWith("/protect/config") && init?.method === "PUT") {
        return jsonResponse({ securityReviewModel: "openai/gpt-4o" });
      }
      if (typeof url === "string" && url.endsWith("/protect/config")) {
        return jsonResponse({ securityReviewModel: "anthropic/claude-sonnet-4" });
      }
      if (typeof url === "string" && url.endsWith("/protect/findings")) {
        return jsonResponse({
          status: "empty",
          findings: [],
          run: null,
          scope: { repositories: [], selected: [], empty: true },
        });
      }
      return jsonResponse({});
    });
  });

  it("renders the picker only for admins", async () => {
    mockUseWorkspaceAccess.mockReturnValue({ canAdmin: true, canWrite: true });
    const { unmount } = render(<ProtectPage />);
    await waitFor(() => {
      expect(screen.getByTestId("model-selector")).toBeInTheDocument();
    });
    unmount();

    mockUseWorkspaceAccess.mockReturnValue({ canAdmin: false, canWrite: true });
    render(<ProtectPage />);
    await waitFor(() => {
      expect(screen.getByTestId("protect-empty")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("model-selector")).not.toBeInTheDocument();
  });

  it("persists the selected model via PUT config", async () => {
    mockUseWorkspaceAccess.mockReturnValue({ canAdmin: true, canWrite: true });
    render(<ProtectPage />);
    await waitFor(() => {
      expect(screen.getByTestId("model-selector")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("select-change"));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        (call) => typeof call[0] === "string" && call[0].endsWith("/protect/config") && call[1]?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
      expect(JSON.parse(putCall![1].body as string)).toEqual({
        securityReviewModel: "openai/gpt-4o",
      });
    });
  });

  it("displays the task default when the stored value is missing from llm-models", async () => {
    mockUseWorkspaceAccess.mockReturnValue({ canAdmin: true, canWrite: true });
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/llm-models") {
        return jsonResponse({ models: MODELS });
      }
      if (typeof url === "string" && url.endsWith("/protect/config")) {
        return jsonResponse({ securityReviewModel: "anthropic/retired-model" });
      }
      if (typeof url === "string" && url.endsWith("/protect/findings")) {
        return jsonResponse({
          status: "empty",
          findings: [],
          run: null,
          scope: { repositories: [], selected: [], empty: true },
        });
      }
      return jsonResponse({});
    });

    render(<ProtectPage />);
    await waitFor(() => {
      expect(screen.getByTestId("select")).toHaveAttribute("data-value", "anthropic/claude-sonnet-4");
    });
    expect(
      fetchMock.mock.calls.some(
        (call) => typeof call[0] === "string" && call[0].endsWith("/protect/config") && call[1]?.method === "PUT",
      ),
    ).toBe(false);
  });
});
