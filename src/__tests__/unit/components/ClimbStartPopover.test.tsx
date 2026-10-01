/**
 * @vitest-environment jsdom
 *
 * Unit tests for the Climb button and its settings:
 * - the form opens with the defaults and an estimate from the task's mean run cost;
 * - a bad target or attempt count is refused inline, and a seed raises the floor;
 * - Start posts the settings (and the seed) to the climbs route and reports the climb;
 * - a refused start is reported as a toast.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

globalThis.React = React;

const mockToast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: () => ({ workspace: { slug: "hive" } }) }));
vi.mock("sonner", () => ({ toast: mockToast }));

const { ClimbStartPopover } = await import("@/components/openhealth/ClimbStartPopover");

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof ResizeObserver === "undefined") {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  }
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ climbId: "climb-1", runId: "run-9" }), { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const open = () => fireEvent.click(screen.getByTestId("openhealth-climb-open"));

describe("ClimbStartPopover", () => {
  it("opens with the defaults and estimates the cost from the task's mean run", async () => {
    render(<ClimbStartPopover gtId={7532} meanRunCost={2.5} />);
    open();

    await waitFor(() => expect(screen.getByTestId("openhealth-climb-form")).toBeTruthy());
    expect((screen.getByTestId("openhealth-climb-target") as HTMLInputElement).value).toBe("1");
    expect((screen.getByTestId("openhealth-climb-attempts") as HTMLInputElement).value).toBe("5");
    expect(screen.getByTestId("openhealth-climb-estimate").textContent).toBe(
      "About $12.50 in benchmark runs for 5 new runs, plus the improve runs.",
    );
  });

  it("refuses a bad target or attempt count inline", async () => {
    render(<ClimbStartPopover gtId={7532} />);
    open();
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-form")).toBeTruthy());

    fireEvent.change(screen.getByTestId("openhealth-climb-attempts"), { target: { value: "11" } });
    expect(screen.getByTestId("openhealth-climb-problem").textContent).toBe("Attempts is a whole number from 1 to 10.");
    expect((screen.getByTestId("openhealth-climb-start") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("openhealth-climb-attempts"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("openhealth-climb-target"), { target: { value: "1.2" } });
    expect(screen.getByTestId("openhealth-climb-problem").textContent).toBe(
      "The target is a score above 0 and at most 1.",
    );
  });

  it("with a seed, needs a target above the seed's score and at least two attempts", async () => {
    render(<ClimbStartPopover gtId={7532} seed={{ runId: "run-1", f1: 0.82 }} label="Keep improving" />);
    open();
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-form")).toBeTruthy());

    fireEvent.change(screen.getByTestId("openhealth-climb-target"), { target: { value: "0.8" } });
    expect(screen.getByTestId("openhealth-climb-problem").textContent).toBe(
      "This run already scored 0.82. Pick a higher target.",
    );

    fireEvent.change(screen.getByTestId("openhealth-climb-target"), { target: { value: "1" } });
    fireEvent.change(screen.getByTestId("openhealth-climb-attempts"), { target: { value: "1" } });
    expect(screen.getByTestId("openhealth-climb-problem").textContent).toBe("Attempts is a whole number from 2 to 10.");
  });

  it("starts the climb with the settings and the seed, and reports it", async () => {
    const onStarted = vi.fn();
    render(<ClimbStartPopover gtId={7532} split="public" seed={{ runId: "run-1", f1: 0.7 }} onStarted={onStarted} />);
    open();
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-form")).toBeTruthy());
    fireEvent.change(screen.getByTestId("openhealth-climb-target"), { target: { value: "0.9" } });
    fireEvent.change(screen.getByTestId("openhealth-climb-attempts"), { target: { value: "4" } });

    fireEvent.click(screen.getByTestId("openhealth-climb-start"));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ climbId: "climb-1", runId: "run-9" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/hive/openhealth/benchmarks/climbs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gtId: 7532, split: "public", targetF1: 0.9, maxAttempts: 4, seedRunId: "run-1" }),
    });
  });

  it("reports a refused start", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "A climb of this task is already running" }), { status: 409 }),
    );
    render(<ClimbStartPopover gtId={7532} />);
    open();
    await waitFor(() => expect(screen.getByTestId("openhealth-climb-form")).toBeTruthy());

    fireEvent.click(screen.getByTestId("openhealth-climb-start"));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith("Could not start the climb", {
        description: "A climb of this task is already running",
      }),
    );
  });
});
