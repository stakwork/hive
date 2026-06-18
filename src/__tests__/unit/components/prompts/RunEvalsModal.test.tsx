/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunEvalsModal } from "@/components/prompts/RunEvalsModal";

const mockEvalSets = [
  { ref_id: "eval-set-1", properties: { name: "Alpha Suite", description: "Tests alpha" } },
  { ref_id: "eval-set-2", properties: { name: "Beta Suite", description: "Tests beta" } },
];

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  versionLabel: "v3",
  workspaceSlug: "test-ws",
  onConfirm: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RunEvalsModal", () => {
  it("renders loading spinner while fetching EvalSets", async () => {
    let resolve: (v: unknown) => void;
    global.fetch = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    ) as unknown as typeof fetch;

    render(<RunEvalsModal {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // spinner shown while pending
    expect(document.querySelector(".animate-spin")).toBeTruthy();

    // unblock
    resolve!({
      ok: true,
      json: async () => ({ nodes: mockEvalSets }),
    });
  });

  it("renders EvalSet list after fetch completes", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ nodes: mockEvalSets }) })
    ) as unknown as typeof fetch;

    render(<RunEvalsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Alpha Suite")).toBeInTheDocument();
      expect(screen.getByText("Beta Suite")).toBeInTheDocument();
    });
  });

  it("shows empty state when API returns no sets", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ nodes: [] }) })
    ) as unknown as typeof fetch;

    render(<RunEvalsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/No eval sets found/i)).toBeInTheDocument();
    });
  });

  it("Run button is disabled when no EvalSet selected", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ nodes: mockEvalSets }) })
    ) as unknown as typeof fetch;

    render(<RunEvalsModal {...defaultProps} />);

    await waitFor(() => expect(screen.getByText("Alpha Suite")).toBeInTheDocument());

    const runButton = screen.getByRole("button", { name: /^Run$/i });
    expect(runButton).toBeDisabled();
  });

  it("Run button is enabled after selecting a set", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ nodes: mockEvalSets }) })
    ) as unknown as typeof fetch;

    render(<RunEvalsModal {...defaultProps} />);

    await waitFor(() => expect(screen.getByText("Alpha Suite")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Alpha Suite"));

    const runButton = screen.getByRole("button", { name: /^Run$/i });
    expect(runButton).not.toBeDisabled();
  });

  it("clicking Run calls onConfirm with the correct ref_id", async () => {
    const onConfirm = vi.fn();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ nodes: mockEvalSets }) })
    ) as unknown as typeof fetch;

    render(<RunEvalsModal {...defaultProps} onConfirm={onConfirm} />);

    await waitFor(() => expect(screen.getByText("Alpha Suite")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Alpha Suite"));
    await userEvent.click(screen.getByRole("button", { name: /^Run$/i }));

    expect(onConfirm).toHaveBeenCalledWith("eval-set-1");
  });

  it("clicking Cancel closes without calling onConfirm", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ nodes: mockEvalSets }) })
    ) as unknown as typeof fetch;

    render(<RunEvalsModal {...defaultProps} onClose={onClose} onConfirm={onConfirm} />);

    await waitFor(() => expect(screen.getByText("Alpha Suite")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("displays version label in the dialog title", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ nodes: [] }) })
    ) as unknown as typeof fetch;

    render(<RunEvalsModal {...defaultProps} versionLabel="v5" />);

    expect(screen.getByText(/Run Evals — v5/i)).toBeInTheDocument();
  });
});
