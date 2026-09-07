// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/admin/components/SwarmPasswordUpdateForm", () => ({
  default: ({
    workspaceId,
    hasPassword,
    onSuccess,
  }: {
    workspaceId: string;
    hasPassword: boolean;
    onSuccess: () => void;
  }) => (
    <button
      type="button"
      data-testid="inner-form"
      data-workspace-id={workspaceId}
      data-has-password={String(hasPassword)}
      onClick={onSuccess}
    >
      succeed
    </button>
  ),
}));

import WorkspaceSwarmPasswordForm from "@/app/admin/workspaces/[slug]/WorkspaceSwarmPasswordForm";

describe("WorkspaceSwarmPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toasts success and refreshes the page when the form succeeds", async () => {
    const user = userEvent.setup();
    render(<WorkspaceSwarmPasswordForm workspaceId="ws-1" hasPassword={true} />);

    const inner = screen.getByTestId("inner-form");
    expect(inner).toHaveAttribute("data-workspace-id", "ws-1");
    expect(inner).toHaveAttribute("data-has-password", "true");

    await user.click(inner);

    expect(toast.success).toHaveBeenCalledWith("Swarm password updated");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
