/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "test-ws" }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("@/components/ui/tag-input", () => ({
  TagInput: ({
    items,
    onChange,
    id,
  }: {
    items: string[];
    onChange: (items: string[]) => void;
    id?: string;
  }) => (
    <div data-testid={`tag-input-${id}`}>
      <input
        data-testid={`tag-input-field-${id}`}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const val = (e.target as HTMLInputElement).value.trim();
            if (val) onChange([...items, val]);
          }
        }}
      />
      {items.map((item, i) => (
        <span key={i} data-testid="tag-chip">{item}</span>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ id, value, onChange, ...props }: any) => (
    <input id={id} value={value} onChange={onChange} {...props} />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

import { CaptureEvalTriggerModal } from "@/components/evals/CaptureEvalTriggerModal";
import { toast } from "sonner";

const DEFAULT_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  evalSetId: "eval-set-1",
  reqId: "req-1",
  onCreated: vi.fn(),
};

const MOCK_ROLES = [
  { ref_id: "role-1", node_type: "AgentRole", properties: { name: "Code Reviewer" } },
  { ref_id: "role-2", node_type: "AgentRole", properties: { name: "Task Agent" } },
];

const MOCK_SESSIONS = [
  {
    ref_id: "sess-1",
    node_type: "AgentSession",
    properties: { name: "Session Alpha", created_at: "2024-01-15" },
  },
];

describe("CaptureEvalTriggerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Step 1 fields on open", () => {
    global.fetch = vi.fn();
    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} />);

    expect(screen.getByLabelText(/Agent/i)).toBeTruthy();
    expect(screen.getByLabelText(/Start Point/i)).toBeTruthy();
    expect(screen.getByLabelText(/End Point/i)).toBeTruthy();
    expect(screen.getByLabelText(/Environment/i)).toBeTruthy();
    expect(screen.getByLabelText(/Run Count/i)).toBeTruthy();
    expect(screen.getByTestId("tag-input-positive_cases")).toBeTruthy();
    expect(screen.getByTestId("tag-input-negative_cases")).toBeTruthy();
  });

  it("does NOT render feedback_note field anywhere", () => {
    global.fetch = vi.fn();
    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} />);

    const html = document.body.innerHTML;
    expect(html.toLowerCase()).not.toContain("feedback_note");
    expect(html.toLowerCase()).not.toContain("feedback note");
  });

  it("Next button is disabled when required fields are empty", () => {
    global.fetch = vi.fn();
    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} />);

    const nextBtn = screen.getByTestId("next-step-btn");
    expect(nextBtn).toBeDisabled();
  });

  it("Next button enabled after required Step 1 fields are filled", async () => {
    global.fetch = vi.fn();
    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} />);

    await userEvent.type(screen.getByLabelText(/Agent/i), "Code Reviewer");
    await userEvent.type(screen.getByLabelText(/Start Point/i), "PR opened");
    await userEvent.type(screen.getByLabelText(/End Point/i), "Review submitted");
    await userEvent.type(screen.getByLabelText(/Environment/i), "staging");

    expect(screen.getByTestId("next-step-btn")).not.toBeDisabled();
  });

  it("transitions from Step 1 to Step 2 on Next click", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_ROLES } }),
    });
    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} />);

    await userEvent.type(screen.getByLabelText(/Agent/i), "Code Reviewer");
    await userEvent.type(screen.getByLabelText(/Start Point/i), "PR opened");
    await userEvent.type(screen.getByLabelText(/End Point/i), "Review submitted");
    await userEvent.type(screen.getByLabelText(/Environment/i), "staging");

    await userEvent.click(screen.getByTestId("next-step-btn"));

    expect(screen.getByText(/Select Session — Step 2 of 2/i)).toBeTruthy();
    expect(screen.getByTestId("role-filter-input")).toBeTruthy();
  });

  it("calls agent-roles API with ?name= param when role filter changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_ROLES } }),
    });
    global.fetch = fetchMock as any;
    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} />);

    // Go to step 2
    await userEvent.type(screen.getByLabelText(/Agent/i), "Code Reviewer");
    await userEvent.type(screen.getByLabelText(/Start Point/i), "PR opened");
    await userEvent.type(screen.getByLabelText(/End Point/i), "Review submitted");
    await userEvent.type(screen.getByLabelText(/Environment/i), "staging");
    await userEvent.click(screen.getByTestId("next-step-btn"));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => u.includes("/evals/agent-roles"))).toBe(true);
    });

    // Type in filter
    await userEvent.type(screen.getByTestId("role-filter-input"), "task");

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => u.includes("name=task"))).toBe(true);
    });
  });

  it("fetches sessions when a role is selected", async () => {
    const fetchMock = vi
      .fn()
      // roles fetch
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_ROLES } }) })
      // sessions fetch
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_SESSIONS } }) });
    global.fetch = fetchMock as any;

    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} />);

    await userEvent.type(screen.getByLabelText(/Agent/i), "Code Reviewer");
    await userEvent.type(screen.getByLabelText(/Start Point/i), "PR opened");
    await userEvent.type(screen.getByLabelText(/End Point/i), "Review submitted");
    await userEvent.type(screen.getByLabelText(/Environment/i), "staging");
    await userEvent.click(screen.getByTestId("next-step-btn"));

    await waitFor(() => expect(screen.getAllByTestId("role-option")).toHaveLength(2));

    await userEvent.click(screen.getAllByTestId("role-option")[0]);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => u.includes("role_ref_id=role-1"))).toBe(true);
    });
  });

  it("calls POST with correct payload and no feedback_note on confirm", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_ROLES } }) })
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_SESSIONS } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    global.fetch = fetchMock as any;

    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} />);

    // Fill Step 1
    await userEvent.type(screen.getByLabelText(/Agent/i), "Code Reviewer");
    await userEvent.type(screen.getByLabelText(/Start Point/i), "PR opened");
    await userEvent.type(screen.getByLabelText(/End Point/i), "Review submitted");
    await userEvent.type(screen.getByLabelText(/Environment/i), "staging");
    await userEvent.click(screen.getByTestId("next-step-btn"));

    // Step 2: select role
    await waitFor(() => expect(screen.getAllByTestId("role-option")).toHaveLength(2));
    await userEvent.click(screen.getAllByTestId("role-option")[0]);

    // Select session
    await waitFor(() => expect(screen.getAllByTestId("session-option")).toHaveLength(1));
    const radio = screen.getByRole("radio");
    await userEvent.click(radio);

    // Confirm
    await userEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall![1].body);
      expect(body.agent).toBe("Code Reviewer");
      expect(body.start_point).toBe("PR opened");
      expect(body.end_point).toBe("Review submitted");
      expect(body.environment).toBe("staging");
      expect(body.session_ref_id).toBe("sess-1");
      expect(body).not.toHaveProperty("feedback_note");
    });

    expect(toast.success).toHaveBeenCalledWith("Eval trigger captured");
    expect(DEFAULT_PROPS.onCreated).toHaveBeenCalled();
    expect(DEFAULT_PROPS.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows error toast when POST fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_ROLES } }) })
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_SESSIONS } }) })
      .mockResolvedValueOnce({ ok: false });
    global.fetch = fetchMock as any;

    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} />);

    await userEvent.type(screen.getByLabelText(/Agent/i), "Code Reviewer");
    await userEvent.type(screen.getByLabelText(/Start Point/i), "PR opened");
    await userEvent.type(screen.getByLabelText(/End Point/i), "Review submitted");
    await userEvent.type(screen.getByLabelText(/Environment/i), "staging");
    await userEvent.click(screen.getByTestId("next-step-btn"));

    await waitFor(() => expect(screen.getAllByTestId("role-option")).toHaveLength(2));
    await userEvent.click(screen.getAllByTestId("role-option")[0]);

    await waitFor(() => expect(screen.getAllByTestId("session-option")).toHaveLength(1));
    await userEvent.click(screen.getByRole("radio"));

    await userEvent.click(screen.getByTestId("confirm-btn"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to capture eval trigger");
    });
  });

  it("does not render when open is false", () => {
    global.fetch = vi.fn();
    render(<CaptureEvalTriggerModal {...DEFAULT_PROPS} open={false} />);
    expect(screen.queryByTestId("dialog")).toBeNull();
  });
});
