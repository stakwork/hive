import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunReportView } from "@/components/run-report/RunReportView";
import { SectionErrorBoundary, EmptyPanel } from "@/components/run-report/chrome";
import { projectBundle } from "@/lib/run-report/project";
import { RUN_REPORT_FIXTURES } from "@/app/api/mock/run-report/fixtures";
import type { RunReportPayload, RunReportProjection } from "@/lib/run-report/types";

vi.mock("@/hooks/useUserTimezone", () => ({
  useUserTimezone: () => ({ timezone: "America/New_York" }),
}));

function projectionFor(name: keyof typeof RUN_REPORT_FIXTURES): RunReportProjection {
  const outcome = projectBundle(JSON.stringify(RUN_REPORT_FIXTURES[name]));
  if (outcome.status !== "ok") throw new Error(`fixture ${name} did not project`);
  return outcome.projection;
}

function payload(overrides: Partial<RunReportPayload> = {}): RunReportPayload {
  return {
    runId: "run-1",
    hasReport: true,
    projection: projectionFor("full"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RunReportView — render states", () => {
  it("renders every report section for a valid bundle", () => {
    render(<RunReportView payload={payload()} />);
    for (const testId of [
      "run-report-header",
      "run-report-section-rubrics",
      "run-report-section-pipeline",
      "run-report-section-agents",
      "run-report-section-concepts",
      "run-report-section-sources",
      "run-report-section-system",
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it("renders no section rail — the ledger is the navigation", () => {
    const { container } = render(<RunReportView payload={payload()} />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("renders the rubric ledger: failed and unscored listed, passes folded", () => {
    render(<RunReportView payload={payload()} />);
    // full fixture: R1 pass, R2 fail, R3 unscored - two open list items,
    // one behind the passes fold
    const items = screen.getAllByTestId("run-report-ledger-item");
    expect(items).toHaveLength(3);
    expect(screen.getByText(/✓ 1 passed/)).toBeInTheDocument();
    // failed-first ordering selects R2 by default; its chain renders hops
    expect(screen.getAllByText(/The deliverable/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Did the checklist represent what the rubric expected/i).length).toBeGreaterThan(0);
  });

  it("renders match criteria and the judge review on the selected failed rubric", () => {
    render(<RunReportView payload={payload()} />);
    // R2 (fail) is selected by default; its criteria text and judge-review
    // block (flagged + prose + excerpt from the fixture) render
    expect(screen.getByText(/identifies section 12\.4 as unilateral/i)).toBeInTheDocument();
    const dispute = screen.getByTestId("run-report-judge-dispute");
    expect(dispute).toHaveTextContent(/may be too strict/i);
    expect(dispute).toHaveTextContent(/terminate this Agreement for convenience/i);
  });

  it("renders no judge review on an all-pass run", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("all-pass") })} />);
    expect(screen.queryByTestId("run-report-judge-dispute")).toBeNull();
  });

  it("shows agent commentary slots only when the bundle carries traces", () => {
    // full fixture has traces -> commentary tier renders
    render(<RunReportView payload={payload()} />);
    expect(screen.getAllByText(/not yet assessed/i).length).toBeGreaterThan(0);
  });

  it("renders the pure scaffold with no commentary slots on deterministic runs", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("deterministic") })} />);
    expect(screen.queryByText(/not yet assessed/i)).toBeNull();
    // the chain itself still stands
    expect(screen.getAllByTestId("run-report-ledger-item").length).toBeGreaterThan(0);
  });

  it("shows the no-report state when there is no projection", () => {
    render(<RunReportView payload={payload({ hasReport: false, projection: null })} />);
    expect(screen.getByTestId("run-report-state-absent")).toBeInTheDocument();
  });

  it("bumped schema_version renders normally — schema gate is removed", () => {
    // The unsupported_schema error type was removed in T2; any schema_version
    // including 99 now projects to "ok" and renders the full report.
    render(<RunReportView payload={payload({ projection: projectionFor("bumped-schema") })} />);
    expect(screen.getByTestId("run-report-view")).toBeInTheDocument();
    expect(screen.queryByTestId("run-report-state-absent")).toBeNull();
    // All sections must render, not just the error state.
    expect(screen.getByTestId("run-report-header")).toBeInTheDocument();
    expect(screen.getByTestId("run-report-section-agents")).toBeInTheDocument();
  });

  it("distinguishes a failed S3 load from a run with no report", () => {
    // A report that exists but couldn't be fetched must not read as "no report".
    render(<RunReportView payload={payload({ error: "unavailable", projection: null })} />);
    expect(screen.getByTestId("run-report-state-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("run-report-state-absent")).toBeNull();
  });
});

describe("RunReportView — fix snapshot section", () => {
  const FIXES = [
    {
      ref_id: "fix-1",
      target_type: "concept",
      target_name: "Limitation of Liability",
      target_ref: "concept-ref-1",
      old_value: JSON.stringify({ docs: "before text" }),
      new_value: JSON.stringify({ docs: "after text" }),
    },
  ];

  it("renders the section in the debugging context when fixSnapshots are provided", () => {
    render(<RunReportView payload={payload()} fixSnapshots={FIXES} />);
    expect(screen.getByTestId("run-report-section-fix-snapshots")).toBeInTheDocument();
    expect(screen.getByText("Limitation of Liability")).toBeInTheDocument();
  });

  it("omits the section when fixSnapshots is null or empty", () => {
    render(<RunReportView payload={payload()} />);
    expect(screen.queryByTestId("run-report-section-fix-snapshots")).toBeNull();

    render(<RunReportView payload={payload()} fixSnapshots={[]} />);
    expect(screen.queryByTestId("run-report-section-fix-snapshots")).toBeNull();
  });

  it("still renders the section when the S3 bundle is unavailable — the data is graph-sourced", () => {
    render(
      <RunReportView
        payload={payload({ error: "unavailable", projection: null })}
        fixSnapshots={FIXES}
      />,
    );
    expect(screen.getByTestId("run-report-state-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("run-report-section-fix-snapshots")).toBeInTheDocument();
  });
});

describe("RunReportView — empty shapes are not errors", () => {
  it("renders concepts: {} as 'not run', never an error", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("no-concepts") })} />);
    expect(screen.getByTestId("run-report-section-concepts")).toHaveTextContent(/not run/i);
    expect(screen.queryByTestId("run-report-state-absent")).toBeNull();
  });

  it("renders an empty analysis.traces without routing to the error state", () => {
    // The deterministic-only run is a legitimate empty state.
    render(<RunReportView payload={payload({ projection: projectionFor("no-analysis") })} />);
    expect(screen.getByTestId("run-report-view")).toBeInTheDocument();
    expect(screen.getByTestId("run-report-section-agents")).toHaveTextContent(/no agent traces/i);
    expect(screen.queryByTestId("run-report-state-absent")).toBeNull();
  });

  it("renders the deterministic agent roster when summaries are empty but agents exist", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("deterministic") })} />);
    const section = screen.getByTestId("run-report-section-agents");
    expect(section).toHaveTextContent(/agent activity/i);
    expect(section).toHaveTextContent(/deterministic run/i);
    expect(screen.getAllByTestId("run-report-deterministic-agent").length).toBeGreaterThan(0);
    // record-form tools render a fold; the roster is metadata, never an error state
    expect(section).toHaveTextContent(/tool calls \(2\)/i);
    expect(screen.queryByTestId("run-report-state-absent")).toBeNull();
  });

  it("renders unsummarized workers alongside LLM summaries", () => {
    render(
      <RunReportView payload={payload({ projection: projectionFor("with-ingest-worker") })} />,
    );
    const section = screen.getByTestId("run-report-section-agents");
    expect(section).toHaveTextContent(/other agent activity \(1\)/i);
    expect(section).toHaveTextContent(/ingest: appointment-chronology\.xlsx/);
    // summaries still render in full
    expect(section).toHaveTextContent(/agent summaries/i);
  });

  it("shows the recorded final answer on summarized agent cards", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("full") })} />);
    const section = screen.getByTestId("run-report-section-agents");
    // both summarized agents carry page_data.agents[].final_answer - each
    // summary card now folds it in alongside the LLM summary
    expect(section.textContent?.match(/final answer/gi)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });



  it("keeps the plain empty state when both summaries and agents are empty", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("no-analysis") })} />);
    expect(screen.getByTestId("run-report-section-agents")).toHaveTextContent(
      /no agent summaries/i,
    );
    expect(screen.queryByTestId("run-report-deterministic-agent")).toBeNull();
  });

  it("renders an all-pass run with every criterion in the passes fold", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("all-pass") })} />);
    expect(screen.getByTestId("run-report-section-rubrics")).toHaveTextContent(/passed/i);
  });

  it("renders strings-only fixture without errors (empty arrays degrade cleanly)", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("strings-only") })} />);
    expect(screen.getByTestId("run-report-view")).toBeInTheDocument();
    // security: [] renders the health section without throwing
    expect(screen.getByTestId("run-report-section-system")).toBeInTheDocument();
    // concepts: {} renders as "not run"
    expect(screen.getByTestId("run-report-section-concepts")).toHaveTextContent(/not run/i);
  });
});

/** A component that always throws — used to verify the error boundary catches it. */
function Bomb(): React.ReactElement {
  throw new Error("intentional render error");
}

describe("RunReportView — section error boundary", () => {
  it("catches a thrown child and renders the fallback panel instead of blanking the page", () => {
    // Suppress React error boundary console.error output during the test.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <div>
        <SectionErrorBoundary>
          <Bomb />
        </SectionErrorBoundary>
        <div data-testid="sibling-section">Still here</div>
      </div>,
    );

    consoleSpy.mockRestore();

    // The boundary renders the fallback instead of the throwing child.
    expect(container.textContent).toContain("This section couldn't be rendered.");
    // The sibling section is unaffected — the whole page did not unmount.
    expect(screen.getByTestId("sibling-section")).toBeInTheDocument();
    expect(screen.getByTestId("sibling-section")).toHaveTextContent("Still here");
  });

  it("keeps run-report-section-agents testid alive after the TracesSection renders", () => {
    // The Agents section keeps its single nav destination and testid — not split.
    render(<RunReportView payload={payload()} />);
    expect(screen.getByTestId("run-report-section-agents")).toBeInTheDocument();
  });
});

describe("RunReportView — escaped prose", () => {
  it("renders the concepts narrative as text, not as markup", () => {
    render(<RunReportView payload={payload()} />);
    const narrative = screen.getByTestId("run-report-concept-narrative");

    // The fixture embeds a ```mermaid fence and raw HTML. Both must appear as
    // literal characters — MarkdownRenderer would route the fence into
    // MermaidDiagram, which is a dangerouslySetInnerHTML sink.
    expect(narrative.textContent).toContain("```mermaid");
    expect(narrative.textContent).toContain("<script>");
    expect(narrative.querySelector("script")).toBeNull();
    expect(narrative.querySelector("img")).toBeNull();
  });
});

describe("RunReportView — ToolActivitySection nav and render", () => {

  it("v1 full fixture renders without crashing (ToolActivitySection returns null)", () => {
    // The full fixture has toolActivity.present: false so the section renders nothing
    render(<RunReportView payload={payload({ projection: projectionFor("full") })} />);
    expect(screen.getByTestId("run-report-view")).toBeInTheDocument();
    // All standard sections still present
    expect(screen.getByTestId("run-report-section-agents")).toBeInTheDocument();
    expect(screen.getByTestId("run-report-section-concepts")).toBeInTheDocument();
  });
});

describe("RunReportView — no HTML sink reaches the DOM", () => {
  it("renders sanitized document content without script/img/iframe nodes", () => {
    const { container } = render(<RunReportView payload={payload()} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    // NOTE: not asserting "no svg" — lucide-react icons are our own trusted
    // components and legitimately render SVG. What must never appear is the
    // foreign-content mXSS vector carried by the bundle.
    expect(container.querySelector("foreignObject")).toBeNull();
    expect(container.querySelector("math")).toBeNull();
  });

  it("never renders the bundle URL or any storage URL variant", () => {
    const { container } = render(<RunReportView payload={payload()} />);
    expect(container.innerHTML).not.toContain("amazonaws.com");
    expect(container.innerHTML).not.toContain("report_url");
    expect(container.innerHTML).not.toContain("s3_url");
    expect(container.innerHTML).not.toContain("signed_url");
    expect(container.innerHTML).not.toContain("presigned_url");
    expect(container.innerHTML).not.toContain("download_url");
  });
});
