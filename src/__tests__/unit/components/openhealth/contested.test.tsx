/**
 * @vitest-environment jsdom
 *
 * Contested gold on the OpenHealth Benchmarks page: a score that excludes
 * contested answer-key items says so wherever it appears — the run viewer,
 * the climb strip, the hill-climb chart, the table cell.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OpenHealthClimb, OpenHealthClimbStep, OpenHealthRunDetail } from "@/types/openhealth";
import type { OpenHealthClimbPoint } from "@/lib/openhealth-benchmarks/runs";

globalThis.React = React;

vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: () => ({ workspace: { slug: "hive" } }) }));
vi.mock("@/hooks/useWorkspaceAccess", () => ({ useWorkspaceAccess: () => ({ canWrite: true }) }));
vi.mock("@/components/strut-run-graph", () => ({ StrutRunGraph: () => null }));
vi.mock("@/components/openhealth/ClimbStartPopover", () => ({ ClimbStartPopover: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OpenHealthRunViewer } from "@/components/openhealth/OpenHealthRunViewer";
import { OpenHealthClimbStrip } from "@/components/openhealth/OpenHealthClimbStrip";
import { OpenHealthClimbChart } from "@/components/openhealth/OpenHealthClimbChart";
import { ContestedNote, ScoreCell } from "@/components/openhealth/parts";

const CONTEST = {
  id: "oh-context-summarization-public-8274-contested-must-include-findings-primigravida",
  refId: "89aa4209-4e75-4715-959a-72ba20fbfe54",
  name: "Primigravida",
  list: "must_include_findings",
  icd10: null,
  reason: "Gold expects 'Primigravida' but the chart documents a prior pregnancy.",
  evidence: ['chart.md: "Cesarean section (low transverse, 2 years prior)"', 'gold.json: "30-year-old G2P1"'],
};

const RUN: OpenHealthRunDetail = {
  id: "run-1",
  strutRunId: "1790979304680",
  status: "SUCCESS",
  outcome: "succeeded",
  gtId: 8274,
  patientId: 1675,
  difficulty: "medium",
  task: "patient_diagnosis",
  variant: null,
  specialty: null,
  scores: {
    f1: 1,
    metric: "weighted_problem_list_f1_neutral",
    official: 0.92,
    contested: 1,
    recall: 1,
    precision: 1,
    tier: "A",
    nMatched: 12,
    nGt: 12,
    nPred: 12,
  },
  costUsd: 1.2,
  durationMs: 174_000,
  error: null,
  createdAt: "2026-10-02T22:15:04.000Z",
  settledAt: "2026-10-02T22:18:00.000Z",
  title: "context_summarization gt 8274 patient 1675",
  namespace: "oh-public-p1675",
  clinicalQuestion: null,
  matched: [{ pred: "Hypertension", gt: "Hypertension" }],
  missed: [],
  extra: [],
  found: [],
  summaryWords: null,
  criticalCount: null,
  metrics: {},
  chart: {
    chartChars: 5849,
    sectionCount: 36,
    sectionsIngested: 36,
    sectionsFailed: [],
    encounterCount: 3,
    withheldSections: [],
  },
  ingested: [],
  contested: [CONTEST],
  contestsRejected: [{ error: "Upper abdominal pain", reason: "The quote is not in the chart." }],
  produceCost: 1,
  produceSteps: 40,
  spreadsheetUrl: null,
};

function step(overrides: Partial<OpenHealthClimbStep>): OpenHealthClimbStep {
  return {
    kind: "benchmark",
    iteration: 0,
    outcome: "succeeded",
    f1: 0.6,
    metric: null,
    f1Official: null,
    contested: [],
    recall: null,
    precision: null,
    newBest: true,
    missed: [],
    extra: [],
    costUsd: null,
    stages: null,
    applied: false,
    created: [],
    amended: [],
    rejected: [],
    contestsAccepted: [],
    contestsRejected: [],
    summary: null,
    startedAt: null,
    error: null,
    ...overrides,
  };
}

const CLIMB: OpenHealthClimb = {
  id: "climb-1",
  strutRunId: "1790979304680",
  gtId: 8274,
  difficulty: "medium",
  task: "patient_diagnosis",
  variant: null,
  specialty: null,
  status: "reached",
  stopReason: "Run 2 scored 1.00.",
  targetF1: 1,
  maxRuns: 3,
  attempts: 2,
  startF1: 0.6,
  bestF1: 1,
  bestF1Official: 0.92,
  bestRecall: null,
  bestPrecision: null,
  latestF1: 1,
  bestIteration: 1,
  costUsd: null,
  contested: ["Primigravida"],
  steps: [
    step({ iteration: 0, f1: 0.6 }),
    step({
      kind: "improve",
      iteration: 0,
      f1: null,
      newBest: false,
      applied: true,
      contestsAccepted: ["Primigravida"],
    }),
    step({ iteration: 1, f1: 1, f1Official: 0.92, contested: ["Primigravida"] }),
  ],
  durationMs: 600_000,
  error: null,
  createdAt: "2026-10-02T22:15:04.000Z",
  settledAt: "2026-10-02T22:25:04.000Z",
};

describe("the run viewer", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
      const body = url.endsWith("/improve") ? { improvements: [] } : RUN;
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("marks a contested score, lists each contested item with its quotes, and links it to the graph", async () => {
    render(<OpenHealthRunViewer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-run-contested-badge")).toBeDefined());
    expect(screen.getByTestId("openhealth-run-contested-badge").textContent).toBe("1 contested");
    expect(screen.getByTestId("openhealth-run-scores").textContent).toContain("1.00");
    expect(screen.getByTestId("openhealth-contested-note").textContent).toBe("1 contested");

    const list = screen.getByTestId("openhealth-run-contested");
    expect(list.textContent).toContain("Primigravida");
    expect(list.textContent).toContain("in must include findings");
    expect(list.textContent).toContain(CONTEST.reason);
    expect(screen.getByTestId("openhealth-contest-evidence").textContent).toContain('gold.json: "30-year-old G2P1"');
    expect(screen.getByTestId("openhealth-contest-graph").getAttribute("href")).toBe(
      `/w/hive/context/graph?ref_id=${CONTEST.refId}`,
    );
    expect(screen.getByTestId("openhealth-run-contests-rejected").textContent).toContain("Upper abdominal pain");
  });

  it("shows the contested list on a summary run too", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const body = url.endsWith("/improve")
        ? { improvements: [] }
        : {
            ...RUN,
            task: "context_summarization",
            scores: { ...RUN.scores!, metric: "clinical_f1", recall: null, precision: null, tier: null },
            matched: [],
            found: ["Hypertension", "Headache"],
            summaryWords: 437,
          };
      return { ok: true, json: async () => body } as Response;
    });
    render(<OpenHealthRunViewer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-run-contested")).toBeDefined());
    expect(screen.getByTestId("openhealth-run-found").textContent).toContain("Hypertension");
    expect(screen.getByTestId("openhealth-contested-note").textContent).toBe("1 contested");
    expect(screen.getByTestId("openhealth-run-contested").textContent).toContain("Primigravida");
  });

  it("shows nothing about contests on a run that had none", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const body = url.endsWith("/improve")
        ? { improvements: [] }
        : { ...RUN, scores: { ...RUN.scores!, official: 1, contested: 0 }, contested: [], contestsRejected: [] };
      return { ok: true, json: async () => body } as Response;
    });
    render(<OpenHealthRunViewer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-run-scores")).toBeDefined());
    expect(screen.queryByTestId("openhealth-run-contested-badge")).toBeNull();
    expect(screen.queryByTestId("openhealth-contested-note")).toBeNull();
    expect(screen.queryByTestId("openhealth-run-contested")).toBeNull();
  });
});

describe("the climb strip", () => {
  it("marks the contested run's chip and names the contests in the headline", () => {
    render(<OpenHealthClimbStrip climb={CLIMB} />);
    expect(screen.getByTestId("openhealth-climb-meta").textContent).toContain("1 contested, 0.92 official");
    const chips = screen.getAllByTestId("openhealth-climb-step");
    expect(chips[0].querySelector('[data-testid="openhealth-climb-step-contested"]')).toBeNull();
    expect(chips[1].textContent).toContain("1 contested");
    expect(chips[2].querySelector('[data-testid="openhealth-climb-step-contested"]')?.textContent).toBe("1 contested");
  });
});

describe("the hill-climb chart", () => {
  const point = (key: string, f1: number, contested: number): OpenHealthClimbPoint => ({
    key,
    runId: key,
    climb: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    gtId: 8274,
    f1,
    f1Official: contested ? 0.92 : null,
    contested,
    best: f1,
    newBest: true,
  });

  it("rings a contested point", () => {
    render(<OpenHealthClimbChart points={[point("a", 0.6, 0), point("b", 1, 1)]} />);
    expect(screen.getAllByTestId("openhealth-climb-dot")).toHaveLength(2);
    expect(screen.getAllByTestId("openhealth-climb-contested-ring")).toHaveLength(1);
  });
});

describe("the score cell", () => {
  it("is the score alone when nothing was contested, and says what was excluded when something was", () => {
    expect(renderToStaticMarkup(<ScoreCell value="0.82" official={null} contested={0} />)).not.toContain("contested");
    const marked = renderToStaticMarkup(<ScoreCell value="1.00" official={0.92} contested={2} />);
    expect(marked).toContain("1.00");
    expect(marked).toContain("2 contested");
    expect(marked).not.toContain("official");
    expect(marked).toContain("2 answer-key items are contested");
    expect(marked).toContain("The untouched benchmark score is 0.92.");
    expect(renderToStaticMarkup(<ContestedNote official={null} contested={1} />)).toContain("1 contested");
  });
});
