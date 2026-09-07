// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef(
    (props: React.InputHTMLAttributes<HTMLInputElement>, ref: React.Ref<HTMLInputElement>) => (
      <input ref={ref} {...props} />
    ),
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
    "data-testid": testId,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
    "data-testid"?: string;
  }) => (
    <button type={type} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  ),
}));

import SwarmPasswordUpdateForm from "@/app/admin/components/SwarmPasswordUpdateForm";

const WORKSPACE_ID = "ws-123";

function renderForm(
  overrides: Partial<{ hasPassword: boolean; onSuccess: () => void }> = {},
) {
  const onSuccess = overrides.onSuccess ?? vi.fn();
  render(
    <SwarmPasswordUpdateForm
      workspaceId={WORKSPACE_ID}
      hasPassword={overrides.hasPassword ?? true}
      onSuccess={onSuccess}
    />,
  );
  return { onSuccess };
}

describe("SwarmPasswordUpdateForm", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects empty input client-side without sending a request", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderForm();

    await user.click(screen.getByTestId("swarm-password-submit"));

    expect(screen.getByTestId("swarm-password-error")).toHaveTextContent(
      "Password cannot be empty",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rejects whitespace-only input client-side without sending a request", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderForm();

    await user.type(screen.getByTestId("swarm-password-input"), "   ");
    await user.click(screen.getByTestId("swarm-password-submit"));

    expect(screen.getByTestId("swarm-password-error")).toHaveTextContent(
      "Password cannot be empty",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a confirm dialog before overwrite when hasPassword is true", async () => {
    const user = userEvent.setup();
    renderForm({ hasPassword: true });

    await user.type(screen.getByTestId("swarm-password-input"), "new-secret");
    await user.click(screen.getByTestId("swarm-password-submit"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/replace stored swarm password/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send a request when the confirm dialog is cancelled", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderForm({ hasPassword: true });

    await user.type(screen.getByTestId("swarm-password-input"), "new-secret");
    await user.click(screen.getByTestId("swarm-password-submit"));
    await user.click(screen.getByTestId("swarm-password-confirm-cancel"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("PUTs the password and calls onSuccess once after confirm", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    const { onSuccess } = renderForm({ hasPassword: true });

    await user.type(screen.getByTestId("swarm-password-input"), "new-secret");
    await user.click(screen.getByTestId("swarm-password-submit"));
    await user.click(screen.getByTestId("swarm-password-confirm"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/workspaces/${WORKSPACE_ID}/swarm-password`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swarmPassword: "new-secret" }),
      },
    );
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("swarm-password-input")).toHaveValue("");
  });

  it("skips the confirm dialog and PUTs immediately when hasPassword is false", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    const { onSuccess } = renderForm({ hasPassword: false });

    await user.type(screen.getByTestId("swarm-password-input"), "first-secret");
    await user.click(screen.getByTestId("swarm-password-submit"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "swarmPassword cannot be empty"],
    [404, "Swarm not found"],
    [500, "Request failed (500)"],
  ])("surfaces a %s error inline and does not call onSuccess", async (status, error) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      status,
      json: async () => (status === 500 ? {} : { error }),
    });
    const { onSuccess } = renderForm({ hasPassword: false });

    await user.type(screen.getByTestId("swarm-password-input"), "new-secret");
    await user.click(screen.getByTestId("swarm-password-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("swarm-password-error")).toHaveTextContent(error);
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId("swarm-password-input")).toHaveValue("new-secret");
  });
});
