import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunReportView } from "@/components/run-report/RunReportView";
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

  it("renders the rubric heat-strip with one cell per criterion", () => {
    render(<RunReportView payload={payload()} />);
    expect(screen.getAllByTestId("run-report-rubric-cell")).toHaveLength(3);
  });

  it("shows the no-report state when there is no projection", () => {
    render(<RunReportView payload={payload({ hasReport: false, projection: null })} />);
    expect(screen.getByTestId("run-report-state-absent")).toBeInTheDocument();
  });

  it("shows the absent state when projection is null (gate removed — bumped schema now renders normally)", () => {
    // The unsupported_schema error type is removed in T2; any schema_version
    // now projects to "ok". A null projection (e.g. unfetched report) still
    // routes to the absent/unavailable state.
    render(
      <RunReportView payload={payload({ hasReport: false, projection: null })} />,
    );
    expect(screen.getByTestId("run-report-state-absent")).toBeInTheDocument();
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

  it("renders an all-pass run with no failures panel content", () => {
    render(<RunReportView payload={payload({ projection: projectionFor("all-pass") })} />);
    expect(screen.getByTestId("run-report-section-failures")).toHaveTextContent(/no failures/i);
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

  it("never renders the bundle URL", () => {
    const { container } = render(<RunReportView payload={payload()} />);
    expect(container.innerHTML).not.toContain("amazonaws.com");
    expect(container.innerHTML).not.toContain("report_url");
  });
});
