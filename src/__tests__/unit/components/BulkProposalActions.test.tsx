import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { BulkProposalActions } from "@/app/w/[slug]/learn/components/BulkProposalActions";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" "),
}));

describe("BulkProposalActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when nothing is selected and there are no failures", () => {
    const { container } = render(
      <BulkProposalActions
        selectedCount={0}
        submitting={false}
        results={null}
        lastAction={null}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("disables actions while submitting, empty, or over cap", () => {
    const { rerender } = render(
      <BulkProposalActions
        selectedCount={2}
        submitting
        results={null}
        lastAction="accept"
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("learn-bulk-accept")).toBeDisabled();

    rerender(
      <BulkProposalActions
        selectedCount={26}
        submitting={false}
        results={null}
        lastAction={null}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("learn-bulk-accept")).toBeDisabled();
    expect(screen.getByTestId("learn-bulk-reject")).toBeDisabled();
  });

  it("toasts successes and lists closed-set failure copy", () => {
    render(
      <BulkProposalActions
        selectedCount={2}
        submitting={false}
        lastAction="accept"
        onAccept={vi.fn()}
        onReject={vi.fn()}
        results={[
          { id: "ok", ok: true },
          { id: "stale", ok: false, code: "stale_base" },
          { id: "gone", ok: false, code: "not_found" },
          { id: "err", ok: false, code: "upstream_error" },
        ]}
      />,
    );
    expect(toast.success).toHaveBeenCalledWith("Accepted 1 proposal");
    const failures = screen.getAllByTestId("learn-bulk-proposal-failure");
    expect(failures.map((el) => el.textContent)).toEqual([
      "stale — Needs re-review",
      "gone — No longer available",
      "err — Something went wrong — try again",
    ]);
  });

  it("invokes accept and reject handlers", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(
      <BulkProposalActions
        selectedCount={1}
        submitting={false}
        results={null}
        lastAction={null}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByTestId("learn-bulk-accept"));
    fireEvent.click(screen.getByTestId("learn-bulk-reject"));
    expect(onAccept).toHaveBeenCalled();
    expect(onReject).toHaveBeenCalled();
  });
});
