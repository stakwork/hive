// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentSessionCaptureModal } from "@/components/evals/AgentSessionCaptureModal";

// ── mocks ────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { CREATE_NEW_VALUE } = vi.hoisted(() => ({ CREATE_NEW_VALUE: "__create_new__" }));

vi.mock("@/components/evals/CaptureEvalForm", () => ({
  CREATE_NEW_VALUE,
  CaptureEvalForm: ({
    requirement,
    reason,
    onRequirementChange,
    onReasonChange,
    submitting,
  }: {
    requirement: string;
    reason: string;
    onRequirementChange: (v: string) => void;
    onReasonChange: (v: string) => void;
    submitting?: boolean;
  }) => (
    <div data-testid="capture-eval-form">
      <input
        aria-label="requirement"
        value={requirement}
        onChange={(e) => onRequirementChange(e.target.value)}
        disabled={submitting}
      />
      <input
        aria-label="reason"
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        disabled={submitting}
      />
    </div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (v: boolean) => void;
    children: React.ReactNode;
  }) =>
    open ? (
      <div data-testid="dialog" onClick={() => onOpenChange?.(false)}>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  // Default: eval sets response
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        nodes: [{ ref_id: "evalset-1", name: "My Eval Set" }],
      },
    }),
  });
  // localStorage stub
  vi.stubGlobal("localStorage", {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function renderModal(props: Partial<React.ComponentProps<typeof AgentSessionCaptureModal>> = {}) {
  const defaults = {
    open: true,
    onOpenChange: vi.fn(),
    slug: "my-workspace",
    logId: "log-123",
  };
  return render(<AgentSessionCaptureModal {...defaults} {...props} />);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("AgentSessionCaptureModal", () => {
  describe("dialog title", () => {
    it("shows 'Entire Session' when turnIndex is undefined", () => {
      renderModal({ turnIndex: undefined });
      expect(screen.getByTestId("dialog-title")).toHaveTextContent(
        "Capture Eval — Entire Session"
      );
    });

    it("shows 'Up to Turn 3' when turnIndex=2", () => {
      renderModal({ turnIndex: 2 });
      expect(screen.getByTestId("dialog-title")).toHaveTextContent(
        "Capture Eval — Up to Turn 3"
      );
    });

    it("shows 'Up to Turn 1' when turnIndex=0", () => {
      renderModal({ turnIndex: 0 });
      expect(screen.getByTestId("dialog-title")).toHaveTextContent(
        "Capture Eval — Up to Turn 1"
      );
    });
  });

  describe("confirm handler — POST body", () => {
    async function submitModal(extraProps: Partial<React.ComponentProps<typeof AgentSessionCaptureModal>> = {}) {
      const user = userEvent.setup();
      // Fetch sequence: 1) GET evals, 2) POST capture
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { nodes: [{ ref_id: "evalset-1", name: "My Set" }] } }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      renderModal(extraProps);

      // Wait for eval sets to load
      await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/evals")
      ));

      // Fill requirement field
      const reqInput = screen.getByRole("textbox", { name: /requirement/i });
      await user.type(reqInput, "Agent must respond correctly");

      // Click Confirm
      const confirmBtn = screen.getByRole("button", { name: /confirm/i });
      await user.click(confirmBtn);

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("/eval/capture"),
          expect.any(Object)
        )
      );

      const captureCall = mockFetch.mock.calls.find((c) =>
        (c[0] as string).includes("/eval/capture")
      );
      const body = JSON.parse(captureCall![1].body as string);
      return body;
    }

    it("includes turnIndex in POST body when set", async () => {
      const body = await submitModal({ turnIndex: 4 });
      expect(body.turnIndex).toBe(4);
    });

    it("omits turnIndex from POST body when undefined", async () => {
      const body = await submitModal({ turnIndex: undefined });
      expect(body).not.toHaveProperty("turnIndex");
    });

    it("includes evalSetId and requirement in POST body", async () => {
      const body = await submitModal({ turnIndex: 1 });
      expect(body.evalSetId).toBe("evalset-1");
      expect(body.requirement).toBe("Agent must respond correctly");
    });
  });

  describe("modal state reset", () => {
    it("closes when Cancel is clicked", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      renderModal({ onOpenChange });

      const cancelBtn = screen.getByRole("button", { name: /cancel/i });
      await user.click(cancelBtn);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
