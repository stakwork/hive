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
      "run-report-section-overview",
      "run-report-section-pipeline",
      "run-report-section-rubrics",
      "run-report-section-failures",
      "run-report-section-agents",
      "run-report-section-concepts",
      "run-report-section-sources",
      "run-report-section-system",
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it("renders the section rail with a link per section", () => {
    const { container } = render(<RunReportView payload={payload()} />);
    const railLinks = [...container.querySelectorAll('nav a[href^="#"]')].map((a) =>
      a.getAttribute("href"),
    );
    expect(railLinks).toContain("#overview");
    expect(railLinks).toContain("#rubrics");
    expect(railLinks).toContain("#system");
  });

  it("renders the rubric heat-strip with one cell per criterion (≥3 from full fixture)", () => {
    render(<RunReportView payload={payload()} />);
    // The full fixture has exactly 3 rubrics with mixed verdicts.
    expect(screen.getAllByTestId("run-report-rubric-cell")).toHaveLength(3);
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
    expect(screen.getByTestId("run-report-section-overview")).toBeInTheDocument();
    expect(screen.getByTestId("run-report-section-agents")).toBeInTheDocument();
  });

  it("distinguishes a failed S3 load from a run with no report", () => {
    // A report that exists but couldn't be fetched must not read as "no report".
    render(<RunReportView payload={payload({ error: "unavailable", projection: null })} />);
    expect(screen.getByTestId("run-report-state-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("run-report-state-absent")).toBeNull();
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

  it("lists failed rubrics and every agent in the section rail with matching anchors", () => {
    const { container } = render(
      <RunReportView payload={payload({ projection: projectionFor("full") })} />,
    );
    // failed rubric R2 gets a rail link and an anchored investigation panel
    const failLink = container.querySelector('nav a[href="#failure-r2"]');
    expect(failLink).not.toBeNull();
    expect(container.querySelector("#failure-r2")).not.toBeNull();
    // both summarized agents get rail links and anchored cards
    const agentLink = container.querySelector('nav a[href="#agent-cross-check-agent"]');
    expect(agentLink).not.toBeNull();
    expect(container.querySelector("#agent-cross-check-agent")).not.toBeNull();
    expect(container.querySelector("#agent-drafter")).not.toBeNull();
  });

  it("rail lists deterministic-only agents too", () => {
    const { container } = render(
      <RunReportView payload={payload({ projection: projectionFor("deterministic") })} />,
    );
    expect(container.querySelector('nav a[href="#agent-cross-check-agent"]')).not.toBeNull();
    expect(container.querySelector("#agent-cross-check-agent")).not.toBeNull();
  });

  it("keeps the plain empty state when both summaries and agents are empty", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("no-analysis") })} />);
    expect(screen.getByTestId("run-report-section-agents")).toHaveTextContent(
      /no agent summaries/i,
    );
    expect(screen.queryByTestId("run-report-deterministic-agent")).toBeNull();
  });

  it("renders an all-pass run with no failures panel content", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("all-pass") })} />);
    expect(screen.getByTestId("run-report-section-failures")).toHaveTextContent(/no failures/i);
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
  it("nav rail contains Tool activity link after roster items", () => {
    const { container } = render(
      <RunReportView payload={payload({ projection: projectionFor("with-tool-activity") })} />,
    );
    const toolActivityLink = container.querySelector('nav a[href="#tool-activity"]');
    expect(toolActivityLink).not.toBeNull();
    expect(toolActivityLink!.textContent).toContain("Tool activity");
  });

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
