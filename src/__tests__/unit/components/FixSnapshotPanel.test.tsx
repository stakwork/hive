/**
 * Unit tests for FixSnapshotPanel — the single generic before/after fix
 * snapshot reader.
 *
 * Coverage per the feature brief:
 *   - create / edit / rejected / this-run badges
 *   - body diff rendering (docs and documentation variants both resolve)
 *   - unparseable banner with the raw envelope as ESCAPED text
 *   - explicit legacy empty state
 *   - workflow body suppression (metadata only, raw included)
 *   - live-node control suppressed (not broken) without target_ref
 *   - XSS-shaped payloads in target_name and raw render as text, never markup
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FixSnapshotPanel,
  FixSnapshotSection,
} from "@/components/legal/FixSnapshotPanel";
import { FIX_SNAPSHOT_SHAPES } from "@/app/api/mock/jarvis/graph/fix-snapshot-fixtures";

describe("FixSnapshotPanel — states", () => {
  it("renders a create snapshot with the created badge and an all-additions diff", () => {
    render(
      <FixSnapshotPanel fix={{ ...FIX_SNAPSHOT_SHAPES.conceptCreate }} workspaceSlug="openlaw" />,
    );
    expect(screen.getByTestId("fix-snapshot-badge-create")).toBeInTheDocument();
    expect(screen.queryByTestId("fix-snapshot-badge-edit")).toBeNull();
    expect(screen.getByTestId("fix-snapshot-diff")).toHaveTextContent(
      /Indemnification obligations survive termination/,
    );
    expect(screen.getByText("Indemnification Carve-outs")).toBeInTheDocument();
  });

  it("renders an edit snapshot (docs body) with the edited badge and both diff sides", () => {
    render(
      <FixSnapshotPanel fix={{ ...FIX_SNAPSHOT_SHAPES.conceptEditDocs }} workspaceSlug="openlaw" />,
    );
    expect(screen.getByTestId("fix-snapshot-badge-edit")).toBeInTheDocument();
    const diff = screen.getByTestId("fix-snapshot-diff");
    expect(diff).toHaveTextContent(/willful misconduct/);
  });

  it("resolves a body under `documentation` the same as `docs`", () => {
    render(
      <FixSnapshotPanel
        fix={{ ...FIX_SNAPSHOT_SHAPES.conceptEditDocumentation }}
        workspaceSlug="openlaw"
      />,
    );
    expect(screen.getByTestId("fix-snapshot-diff")).toHaveTextContent(/Termination fees/);
  });

  it("badges a rejected fix (canonical eval_status) while still showing its diff", () => {
    render(
      <FixSnapshotPanel
        fix={{ ...FIX_SNAPSHOT_SHAPES.conceptEditDocs, eval_status: "rejected", status: "accepted" }}
        workspaceSlug="openlaw"
      />,
    );
    expect(screen.getByTestId("fix-snapshot-badge-rejected")).toBeInTheDocument();
    expect(screen.getByTestId("fix-snapshot-diff")).toBeInTheDocument();
  });

  it("badges fixes attributed to the viewed run", () => {
    render(
      <FixSnapshotPanel
        fix={{ ...FIX_SNAPSHOT_SHAPES.conceptEditDocs, fromThisRun: true }}
        workspaceSlug="openlaw"
      />,
    );
    expect(screen.getByTestId("fix-snapshot-badge-this-run")).toBeInTheDocument();
  });

  it("renders the unparseable banner with the raw envelope retained", () => {
    render(
      <FixSnapshotPanel
        fix={{ ...FIX_SNAPSHOT_SHAPES.conceptUnparseable }}
        workspaceSlug="openlaw"
      />,
    );
    const banner = screen.getByTestId("fix-snapshot-unparseable");
    expect(banner).toHaveTextContent(/couldn't be parsed/);
    expect(banner).toHaveTextContent(/Delaware law governs this agr/);
    expect(screen.queryByTestId("fix-snapshot-diff")).toBeNull();
  });

  it("renders the explicit legacy empty state for snapshot-less fixes", () => {
    render(
      <FixSnapshotPanel
        fix={{ ref_id: "legacy-1", target_type: "concept", target_name: "Warranty Scope" }}
        workspaceSlug="openlaw"
      />,
    );
    expect(screen.getByTestId("fix-snapshot-empty")).toHaveTextContent(/No before\/after snapshot/);
  });

  it("treats valid JSON with no body key as empty, not unparseable", () => {
    render(
      <FixSnapshotPanel fix={{ ...FIX_SNAPSHOT_SHAPES.conceptNoBodyKey }} workspaceSlug="openlaw" />,
    );
    expect(screen.getByTestId("fix-snapshot-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("fix-snapshot-unparseable")).toBeNull();
  });

  it("suppresses the body entirely for workflow snapshots — even unparseable raw", () => {
    render(
      <FixSnapshotPanel
        fix={{
          target_type: "workflow",
          target_name: "benchmark-runner",
          old_value: '{"definition": "step with SECRET_TOKEN=abc"}',
          new_value: "{broken-and-secret",
        }}
        workspaceSlug="openlaw"
      />,
    );
    expect(screen.getByTestId("fix-snapshot-workflow-suppressed")).toBeInTheDocument();
    expect(screen.queryByTestId("fix-snapshot-diff")).toBeNull();
    expect(screen.queryByTestId("fix-snapshot-unparseable")).toBeNull();
    expect(screen.queryByText(/SECRET_TOKEN/)).toBeNull();
    expect(screen.queryByText(/broken-and-secret/)).toBeNull();
  });
});

describe("FixSnapshotPanel — live-node link", () => {
  it("renders the open-live-node control when target_ref is present", () => {
    render(
      <FixSnapshotPanel fix={{ ...FIX_SNAPSHOT_SHAPES.conceptEditDocs }} workspaceSlug="openlaw" />,
    );
    expect(screen.getByTestId("fix-snapshot-live-node")).toBeInTheDocument();
  });

  it("suppresses (not breaks) the control when target_ref is absent", () => {
    render(
      <FixSnapshotPanel fix={{ ...FIX_SNAPSHOT_SHAPES.conceptEditNoRef }} workspaceSlug="openlaw" />,
    );
    expect(screen.queryByTestId("fix-snapshot-live-node")).toBeNull();
  });
});

describe("FixSnapshotPanel — sanitization", () => {
  const XSS = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';

  it("renders an XSS-shaped target_name as escaped text", () => {
    const { container } = render(
      <FixSnapshotPanel
        fix={{ ...FIX_SNAPSHOT_SHAPES.conceptEditDocs, target_name: XSS }}
        workspaceSlug="openlaw"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(XSS)).toBeInTheDocument();
  });

  it("renders an XSS-shaped unparseable raw envelope as escaped text", () => {
    const { container } = render(
      <FixSnapshotPanel
        fix={{ target_type: "concept", old_value: "{}", new_value: `{broken ${XSS}` }}
        workspaceSlug="openlaw"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId("fix-snapshot-unparseable").textContent).toContain(XSS);
  });

  it("renders XSS-shaped diff bodies as escaped text", () => {
    const { container } = render(
      <FixSnapshotPanel
        fix={{
          target_type: "concept",
          old_value: JSON.stringify({ docs: "before" }),
          new_value: JSON.stringify({ docs: `after ${XSS}` }),
        }}
        workspaceSlug="openlaw"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("FixSnapshotSection", () => {
  it("renders one panel per fix under the section chrome", () => {
    render(
      <FixSnapshotSection
        fixes={[
          { ref_id: "f1", ...FIX_SNAPSHOT_SHAPES.conceptEditDocs },
          { ref_id: "f2", ...FIX_SNAPSHOT_SHAPES.promptEdit },
          { ref_id: "f3" }, // legacy — explicit empty state
        ]}
        workspaceSlug="openlaw"
      />,
    );
    expect(screen.getByTestId("run-report-section-fix-snapshots")).toBeInTheDocument();
    expect(screen.getAllByTestId("fix-snapshot-panel")).toHaveLength(3);
    expect(screen.getByTestId("fix-snapshot-empty")).toBeInTheDocument();
  });

  it("renders nothing for an empty fix list", () => {
    const { container } = render(<FixSnapshotSection fixes={[]} workspaceSlug="openlaw" />);
    expect(container.firstChild).toBeNull();
  });
});
