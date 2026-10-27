import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FixAction } from "@/components/errors/FixAction";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("FixAction", () => {
  it("enabled Fix button with no badge initially", () => {
    render(<FixAction issueId="i1" />);
    expect(screen.getByTestId("fix-button")).not.toBeDisabled();
    expect(screen.queryByTestId("fix-badge")).toBeNull();
  });

  it("dispatches and shows in-progress badge, disabling the button", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({ data: { fixStatus: "IN_PROGRESS", fixPrUrl: null } }) });
    render(<FixAction issueId="i1" pollMs={100000} />);
    fireEvent.click(screen.getByTestId("fix-button"));
    await waitFor(() => expect(screen.getByText("Fix in progress")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/errors/i1/fix", { method: "POST" });
    expect(screen.getByTestId("fix-button")).toBeDisabled();
  });

  it("shows PR link when opened", () => {
    render(<FixAction issueId="i1" fixStatus="PR_OPENED" fixPrUrl="https://github.com/a/b/pull/1" />);
    expect(screen.getByTestId("fix-pr-link")).toHaveAttribute("href", "https://github.com/a/b/pull/1");
    expect(screen.getByTestId("fix-button")).toBeDisabled();
  });

  it("allows retry after failure", () => {
    render(<FixAction issueId="i1" fixStatus="FAILED" />);
    expect(screen.getByText("Fix failed")).toBeInTheDocument();
    expect(screen.getByTestId("fix-button")).not.toBeDisabled();
    expect(screen.getByText("Retry fix")).toBeInTheDocument();
  });

  it("adopts existing state on 409", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ data: { fixStatus: "PR_OPENED", fixPrUrl: "https://x/pull/2" } }) });
    render(<FixAction issueId="i1" />);
    fireEvent.click(screen.getByTestId("fix-button"));
    await waitFor(() => expect(screen.getByTestId("fix-pr-link")).toBeInTheDocument());
  });

  it("polls while in progress and picks up the PR", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { fixStatus: "PR_OPENED", fixPrUrl: "https://x/pull/3" } }) });
    render(<FixAction issueId="i1" fixStatus="IN_PROGRESS" pollMs={1000} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    vi.useRealTimers();
    expect(fetchMock).toHaveBeenCalledWith("/api/errors/i1/fix");
    expect(screen.getByTestId("fix-pr-link")).toBeInTheDocument();
  });
});
