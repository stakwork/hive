import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { OrgSchematic } from "@/app/org/[githubLogin]/OrgSchematic";

// Mock DiagramViewer so we don't need mermaid rendering
vi.mock("@/app/w/[slug]/learn/components/DiagramViewer", () => ({
  DiagramViewer: ({ name, body, hideHeader }: { name: string; body: string; hideHeader?: boolean }) => (
    <div
      data-testid="diagram-viewer"
      data-name={name}
      data-body={body}
      data-hide-header={String(hideHeader ?? false)}
    />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant, size, className, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ value, onChange, placeholder, className }: any) => (
    <textarea
      data-testid="schematic-textarea"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  ),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrgSchematic", () => {
  it("shows loading state then empty state when no schematic", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schematic: null }),
    });

    render(<OrgSchematic githubLogin="test-org" />);

    // Loading pulse visible initially
    expect(document.querySelector(".animate-pulse")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("No schematic yet.")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-viewer")).toBeNull();
  });

  it("shows DiagramViewer when schematic is saved", async () => {
    const body = "graph TD\n  A --> B";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schematic: body }),
    });

    render(<OrgSchematic githubLogin="test-org" />);

    await waitFor(() => {
      expect(screen.getByTestId("diagram-viewer")).toBeInTheDocument();
    });

    const viewer = screen.getByTestId("diagram-viewer");
    expect(viewer).toHaveAttribute("data-name", "Org Schematic");
    expect(viewer).toHaveAttribute("data-body", body);
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("enters edit mode with starter template when no schematic", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schematic: null }),
    });

    render(<OrgSchematic githubLogin="test-org" />);

    await waitFor(() => screen.getByText("No schematic yet."));

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    const textarea = screen.getByTestId("schematic-textarea");
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).value).toContain("graph TD");
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("enters edit mode pre-filled with existing schematic", async () => {
    const existing = "graph LR\n  X --> Y";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schematic: existing }),
    });

    render(<OrgSchematic githubLogin="test-org" />);

    await waitFor(() => screen.getByTestId("diagram-viewer"));

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    const textarea = screen.getByTestId("schematic-textarea");
    expect((textarea as HTMLTextAreaElement).value).toBe(existing);
  });

  it("Save calls PUT with correct payload and updates state", async () => {
    const newBody = "graph TD\n  A --> C";

    // GET returns null initially
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schematic: null }),
    });
    // PUT returns saved value
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schematic: newBody }),
    });

    render(<OrgSchematic githubLogin="my-org" />);

    await waitFor(() => screen.getByText("No schematic yet."));

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    const textarea = screen.getByTestId("schematic-textarea");
    fireEvent.change(textarea, { target: { value: newBody } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => screen.getByTestId("diagram-viewer"));

    // Verify PUT was called correctly
    const putCall = mockFetch.mock.calls[1];
    expect(putCall[0]).toBe("/api/orgs/my-org/schematic");
    expect(putCall[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schematic: newBody }),
    });

    // Diagram now shows saved content
    expect(screen.getByTestId("diagram-viewer")).toHaveAttribute("data-body", newBody);
  });

  it("Cancel discards unsaved edits and returns to previous state", async () => {
    const existing = "graph TD\n  A --> B";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schematic: existing }),
    });

    render(<OrgSchematic githubLogin="test-org" />);

    await waitFor(() => screen.getByTestId("diagram-viewer"));

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    const textarea = screen.getByTestId("schematic-textarea");
    fireEvent.change(textarea, { target: { value: "graph LR\n  Z --> Q" } });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Returns to view state without PUT
    expect(screen.getByTestId("diagram-viewer")).toHaveAttribute("data-body", existing);
    expect(mockFetch).toHaveBeenCalledTimes(1); // only the initial GET
  });

  it("passes hideHeader={true} to DiagramViewer", async () => {
    const body = "graph TD\n  A --> B";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schematic: body }),
    });

    render(<OrgSchematic githubLogin="test-org" />);

    await waitFor(() => screen.getByTestId("diagram-viewer"));

    const viewer = screen.getByTestId("diagram-viewer");
    expect(viewer).toHaveAttribute("data-hide-header", "true");
  });

  it("wrapper has flex-1 min-h-0 classes and no inline height style", async () => {
    const body = "graph TD\n  A --> B";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schematic: body }),
    });

    const { container } = render(<OrgSchematic githubLogin="test-org" />);

    await waitFor(() => screen.getByTestId("diagram-viewer"));

    // The wrapper div wrapping DiagramViewer should have flex-1 min-h-0
    const wrapper = container.querySelector(".flex-1.min-h-0");
    expect(wrapper).not.toBeNull();
    // Should have no inline height style (no 60vh)
    expect((wrapper as HTMLElement).style.height).toBe("");
  });
});
