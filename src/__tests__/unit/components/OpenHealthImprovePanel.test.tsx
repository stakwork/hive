/**
 * @vitest-environment jsdom
 *
 * Unit tests for the run viewer's Improve panel:
 * - a run nobody improved shows the button and no result;
 * - the button launches an improve run and the panel shows it running;
 * - a finished run shows its new Concepts with what the graph answered, its
 *   amendments, and what it refused or left alone;
 * - a failed run shows its error; a refused launch is reported;
 * - a member who cannot launch gets a disabled button.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { OpenHealthImprovement } from "@/types/openhealth";

globalThis.React = React;

const mockAccess = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/hooks/useWorkspaceAccess", () => ({ useWorkspaceAccess: mockAccess }));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

const { ImprovePanel } = await import("@/components/openhealth/OpenHealthRunViewer/ImprovePanel");

const ENDPOINT = "/api/workspaces/hive/openhealth/benchmarks/runs/run-1/improve";

function improvement(overrides: Partial<OpenHealthImprovement> = {}): OpenHealthImprovement {
  return {
    id: "improve-1",
    strutRunId: "1790625755699",
    outcome: "succeeded",
    applied: true,
    summary: "Two new Concepts and one amend.",
    errorCount: 7,
    proposals: [
      {
        action: "create",
        name: "Newborn Content in Maternal Charts",
        parent: "Obstetrics",
        description: "Delivery encounters that describe the liveborn infant.",
        docs: "## Applies to\nA labor-and-delivery encounter.",
        rationale: "Nothing in the tree told the producer.",
        addresses: ["missed P011", "extra O42919"],
        write: "created",
        writeError: null,
      },
      {
        action: "create",
        name: "Unifying Diagnosis From Findings",
        parent: "Problem List",
        description: null,
        docs: null,
        rationale: null,
        addresses: [],
        write: "failed",
        writeError: "graph/create-triplet: the edge write failed",
      },
      {
        action: "amend",
        name: "Trimester and Specificity",
        parent: null,
        description: "Choosing the trimester character.",
        docs: "Replacement docs.",
        rationale: "The old wording made the producer pick O14.00.",
        addresses: ["wrong code O1403"],
        write: null,
        writeError: null,
      },
    ],
    rejected: [{ name: "Obstetrics", reasons: ["a Concept named 'Obstetrics' already exists"] }],
    notAddressed: [{ error: "extra F411", reason: "Chart-neutral; costs nothing." }],
    durationMs: 231_023,
    error: null,
    createdAt: "2026-09-28T20:02:35.000Z",
    settledAt: "2026-09-28T20:06:26.000Z",
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockReturnValue({ canWrite: true });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImprovePanel", () => {
  it("shows the button and no result for a run nobody improved", async () => {
    mockFetch.mockImplementation(() => json({ improvements: [] }));

    render(<ImprovePanel endpoint={ENDPOINT} />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(ENDPOINT, { cache: "no-store" }));
    expect(screen.getByTestId("openhealth-improve-start")).toBeEnabled();
    expect(screen.queryByTestId("openhealth-improve-result")).not.toBeInTheDocument();
    expect(screen.queryByTestId("openhealth-improve-running")).not.toBeInTheDocument();
  });

  it("launches an improve run and shows it running", async () => {
    let launched = false;
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        launched = true;
        return json({ success: true, improveId: "improve-2" }, 202);
      }
      return json({
        improvements: launched
          ? [improvement({ id: "improve-2", outcome: "running", proposals: [], summary: null }), improvement()]
          : [improvement()],
      });
    });

    render(<ImprovePanel endpoint={ENDPOINT} />);
    await screen.findByTestId("openhealth-improve-result");
    fireEvent.click(screen.getByTestId("openhealth-improve-start"));

    await screen.findByTestId("openhealth-improve-running");
    expect(mockFetch).toHaveBeenCalledWith(ENDPOINT, { method: "POST" });
    expect(screen.getByTestId("openhealth-improve-start")).toBeDisabled();
    expect(screen.getByTestId("openhealth-improve-start")).toHaveTextContent("Improving…");
    expect(screen.queryByTestId("openhealth-improve-result")).not.toBeInTheDocument();
  });

  it("shows what a finished run wrote, proposed, refused and left alone", async () => {
    mockFetch.mockImplementation(() => json({ improvements: [improvement()] }));

    render(<ImprovePanel endpoint={ENDPOINT} />);

    const result = await screen.findByTestId("openhealth-improve-result");
    expect(result).toHaveTextContent("Two new Concepts and one amend.");
    expect(result).toHaveTextContent("7 scoring errors read");

    const creates = within(screen.getByTestId("openhealth-improve-creates")).getAllByTestId(
      "openhealth-improve-proposal",
    );
    expect(creates).toHaveLength(2);
    expect(creates[0]).toHaveTextContent("Newborn Content in Maternal Charts under Obstetrics");
    expect(creates[0]).toHaveTextContent("Added to the graph");
    expect(creates[1]).toHaveTextContent("Not written");

    const amends = within(screen.getByTestId("openhealth-improve-amends")).getAllByTestId(
      "openhealth-improve-proposal",
    );
    expect(amends).toHaveLength(1);
    expect(amends[0]).toHaveTextContent("Trimester and Specificity");
    expect(amends[0]).not.toHaveTextContent(/Not applied|Proposed/);

    expect(screen.getByTestId("openhealth-improve-rejected")).toHaveTextContent("already exists");
    expect(screen.getByTestId("openhealth-improve-not-addressed")).toHaveTextContent("extra F411");
  });

  it("opens a proposal to its docs, its reason and the errors it fixes", async () => {
    mockFetch.mockImplementation(() => json({ improvements: [improvement()] }));

    render(<ImprovePanel endpoint={ENDPOINT} />);
    const [first, second] = await screen.findAllByTestId("openhealth-improve-proposal");
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();

    fireEvent.click(within(first).getByRole("button"));
    expect(first).toHaveTextContent("Fixes missed P011, extra O42919");
    expect(first).toHaveTextContent("Why Nothing in the tree told the producer.");
    expect(within(first).getByTestId("markdown")).toHaveTextContent("A labor-and-delivery encounter.");

    fireEvent.click(within(second).getByRole("button"));
    expect(second).toHaveTextContent("graph/create-triplet: the edge write failed");
  });

  it("says a run that did not apply wrote nothing", async () => {
    mockFetch.mockImplementation(() =>
      json({
        improvements: [
          improvement({
            applied: false,
            proposals: improvement().proposals.map((p) => ({ ...p, write: null, writeError: null })),
          }),
        ],
      }),
    );

    render(<ImprovePanel endpoint={ENDPOINT} />);

    const creates = await screen.findByTestId("openhealth-improve-creates");
    expect(creates).toHaveTextContent("this run did not write to the graph");
    expect(creates).not.toHaveTextContent("Added to the graph");
  });

  it("shows why a run failed", async () => {
    mockFetch.mockImplementation(() =>
      json({
        improvements: [improvement({ outcome: "failed", error: "not_found: runs ['1790614605308']", proposals: [] })],
      }),
    );

    render(<ImprovePanel endpoint={ENDPOINT} />);

    expect(await screen.findByTestId("openhealth-improve-failure")).toHaveTextContent(
      "not_found: runs ['1790614605308']",
    );
    expect(screen.getByTestId("openhealth-improve-start")).toBeEnabled();
  });

  it("reports a launch the server refused", async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ error: "An improve run of this run is already in progress" }, 409)
        : json({ improvements: [] }),
    );

    render(<ImprovePanel endpoint={ENDPOINT} />);
    fireEvent.click(screen.getByTestId("openhealth-improve-start"));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith("Could not start the improve run", {
        description: "An improve run of this run is already in progress",
      }),
    );
    expect(screen.getByTestId("openhealth-improve-start")).toBeEnabled();
  });

  it("disables the button for a member who cannot launch", async () => {
    mockAccess.mockReturnValue({ canWrite: false });
    mockFetch.mockImplementation(() => json({ improvements: [improvement()] }));

    render(<ImprovePanel endpoint={ENDPOINT} />);

    await screen.findByTestId("openhealth-improve-result");
    expect(screen.getByTestId("openhealth-improve-start")).toBeDisabled();
  });
});
