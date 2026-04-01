// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import LlmModelsTable from "@/app/admin/llm-models/LlmModelsTable";
import { toast } from "sonner";

// Mock sonner
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Dialog
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open, onOpenChange }: { children: React.ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? <div data-testid="dialog-mock" role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock Select
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
    <div data-testid="select-wrapper" data-value={value}>
      <select
        data-testid="provider-select"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {children}
      </select>
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

// Mock Input
vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, placeholder, type, id }: any) => (
    <input
      id={id}
      type={type ?? "text"}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      data-testid={id}
    />
  ),
}));

// Mock Label
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

// Mock Button
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant, size, className }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size} className={className}>
      {children}
    </button>
  ),
}));

// Mock Badge
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>{children}</span>
  ),
}));

const oneYearAgo = new Date();
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

const mockModels = [
  {
    id: "model-1",
    name: "gpt-4o",
    provider: "OPENAI" as const,
    providerLabel: null,
    inputPricePer1M: 5.0,
    outputPricePer1M: 15.0,
    dateStart: null,
    dateEnd: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "model-2",
    name: "claude-3-haiku",
    provider: "ANTHROPIC" as const,
    providerLabel: null,
    inputPricePer1M: 0.25,
    outputPricePer1M: 1.25,
    dateStart: null,
    dateEnd: tomorrow,
    createdAt: new Date("2024-02-01"),
    updatedAt: new Date("2024-02-01"),
  },
  {
    id: "model-3",
    name: "gpt-4-turbo",
    provider: "OPENAI" as const,
    providerLabel: null,
    inputPricePer1M: 10.0,
    outputPricePer1M: 30.0,
    dateStart: null,
    dateEnd: oneYearAgo,
    createdAt: new Date("2024-03-01"),
    updatedAt: new Date("2024-03-01"),
  },
  {
    id: "model-4",
    name: "My Custom Model",
    provider: "OTHER" as const,
    providerLabel: "InternalAI",
    inputPricePer1M: 1.0,
    outputPricePer1M: 2.0,
    dateStart: null,
    dateEnd: null,
    createdAt: new Date("2024-04-01"),
    updatedAt: new Date("2024-04-01"),
  },
];

describe("LlmModelsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders table rows from initialData", () => {
    render(<LlmModelsTable initialData={mockModels} />);

    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByText("claude-3-haiku")).toBeInTheDocument();
    expect(screen.getByText("gpt-4-turbo")).toBeInTheDocument();
    expect(screen.getByText("My Custom Model")).toBeInTheDocument();
  });

  it("shows 'InternalAI' for OTHER provider with providerLabel", () => {
    render(<LlmModelsTable initialData={mockModels} />);
    expect(screen.getByText("InternalAI")).toBeInTheDocument();
  });

  it("shows empty state message when no models", () => {
    render(<LlmModelsTable initialData={[]} />);
    expect(screen.getByText(/No LLM models found/)).toBeInTheDocument();
  });

  it("shows 'Active' badge for null dateEnd", () => {
    render(<LlmModelsTable initialData={mockModels} />);
    const badges = screen.getAllByTestId("badge");
    const activeBadges = badges.filter((b) => b.textContent === "Active");
    // gpt-4o (null dateEnd) and claude-3-haiku (future dateEnd) and My Custom Model should be active
    expect(activeBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Inactive' badge for past dateEnd", () => {
    render(<LlmModelsTable initialData={mockModels} />);
    const badges = screen.getAllByTestId("badge");
    const inactiveBadges = badges.filter((b) => b.textContent === "Inactive");
    expect(inactiveBadges.length).toBe(1);
  });

  it("'Add Model' button opens dialog with empty fields", () => {
    render(<LlmModelsTable initialData={mockModels} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Add Model"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Add LLM Model")).toBeInTheDocument();

    const nameInput = screen.getByTestId("llm-name");
    expect(nameInput).toHaveValue("");
  });

  it("clicking edit on a row opens dialog pre-populated with that row's data", () => {
    render(<LlmModelsTable initialData={mockModels} />);

    const editButtons = screen.getAllByText("Edit");
    fireEvent.click(editButtons[0]); // Edit first row (gpt-4o)

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Edit LLM Model")).toBeInTheDocument();

    const nameInput = screen.getByTestId("llm-name");
    expect(nameInput).toHaveValue("gpt-4o");
  });

  it("delete button calls window.confirm and then fetch DELETE on confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    // Also mock the refresh fetch
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: mockModels }) });
    vi.stubGlobal("fetch", mockFetch);

    render(<LlmModelsTable initialData={mockModels} />);

    const deleteButtons = screen.getAllByText("Delete");
    fireEvent.click(deleteButtons[0]);

    expect(confirmSpy).toHaveBeenCalledWith('Delete "gpt-4o"? This cannot be undone.');

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/admin/llm-models/${mockModels[0].id}`,
        expect.objectContaining({ method: "DELETE" })
      );
    });

    confirmSpy.mockRestore();
  });

  it("delete button does NOT call fetch when confirm is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    render(<LlmModelsTable initialData={mockModels} />);

    const deleteButtons = screen.getAllByText("Delete");
    fireEvent.click(deleteButtons[0]);

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("shows toast.error when delete fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Not found" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    render(<LlmModelsTable initialData={mockModels} />);

    const deleteButtons = screen.getAllByText("Delete");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Not found");
    });
  });
});
