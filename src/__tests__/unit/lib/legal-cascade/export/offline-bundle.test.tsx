/**
 * The exported page, end to end in jsdom: execute the real esbuild bundle
 * (cascade-offline.js) against an embedded payload and drive the DOM it
 * mounts — the same UI the Traces panel shows, with concept peeks served
 * from the embedded map and no network.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { assembleRunCascade } from "@/lib/legal-cascade/derive";
import {
  buildMockSessionMap,
  buildMockTurnsBySession,
  MOCK_PLAN_CHILD_ID,
  MOCK_PLAN_SESSION_ID,
  MOCK_REPAIR_SESSION_ID,
} from "@/lib/legal-cascade/fixtures";
import type { CascadeExportPayload } from "@/lib/legal-cascade/export/payload";

const BUNDLE_PATH = join(process.cwd(), "src/lib/legal-cascade/export/cascade-offline.js");
let bundle = "";

beforeAll(() => {
  execFileSync("node", [join(process.cwd(), "scripts/build-cascade-bundle.mjs")], {
    stdio: "pipe",
  });
  bundle = readFileSync(BUNDLE_PATH, "utf8");
}, 120_000);

function payload(): CascadeExportPayload {
  return {
    model: assembleRunCascade(
      [...buildMockSessionMap("147813394").values()],
      buildMockTurnsBySession(),
    ),
    peeks: {
      "onto-1": {
        state: "done",
        payload: {
          ref_id: "onto-1",
          node_type: "Concept",
          name: "wfa-ontology",
          properties: { docs: "The WFA clause ontology, **captured** offline." },
        },
      },
    },
    meta: {
      runId: "run-1",
      identifier: "147813394",
      exportedAt: "2026-09-02T12:00:00.000Z",
      skippedPeeks: [],
    },
  };
}

function mountBundle(data: CascadeExportPayload) {
  document.body.innerHTML = '<div id="cascade-root"></div>';
  (window as unknown as { __CASCADE_EXPORT__?: CascadeExportPayload }).__CASCADE_EXPORT__ = data;
  const fetchSpy = (globalThis as { fetch?: unknown }).fetch;
  let fetched = 0;
  (globalThis as { fetch?: unknown }).fetch = () => {
    fetched += 1;
    return Promise.reject(new Error("offline"));
  };
  // The bundle is a self-executing IIFE; jsdom's document is already loaded,
  // so it mounts synchronously into #cascade-root.
  new Function(bundle)();
  return {
    fetchCount: () => fetched,
    restore: () => {
      (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("cascade-offline.js", () => {
  it("mounts the trace with every agent section and the summary strip", async () => {
    const m = mountBundle(payload());
    try {
      await waitFor(() => expect(screen.getByTestId("offline-cascade-page")).toBeDefined());
      expect(screen.getByTestId(`cascade-agent-${MOCK_PLAN_SESSION_ID}`)).toBeDefined();
      expect(screen.getByTestId(`cascade-agent-${MOCK_REPAIR_SESSION_ID}`)).toBeDefined();
      expect(screen.getByTestId(`cascade-agent-${MOCK_PLAN_CHILD_ID}`)).toBeDefined();
      expect(screen.getByTestId("cascade-summary-strip").textContent).toContain("agents2");
      expect(screen.getByTestId("offline-cascade-page").textContent).toContain("run run-1");
    } finally {
      m.restore();
    }
  });

  it("keeps the interactions: pills unroll and expand-all works", async () => {
    const m = mountBundle(payload());
    try {
      await waitFor(() => expect(screen.getByTestId("run-cascade-trace")).toBeDefined());
      const detail = `cascade-row-detail-${MOCK_PLAN_SESSION_ID}-2`;
      expect(screen.queryByTestId(detail)).toBeNull();
      fireEvent.click(screen.getByTestId(`cascade-pill-${MOCK_PLAN_SESSION_ID}-1`));
      await waitFor(() => expect(screen.getByTestId(detail)).toBeDefined());

      fireEvent.click(screen.getByTestId("cascade-expand-all"));
      await waitFor(() =>
        expect(screen.getByTestId(`cascade-row-detail-${MOCK_REPAIR_SESSION_ID}-1`)).toBeDefined(),
      );
    } finally {
      m.restore();
    }
  });

  it("opens a concept peek from the embedded map without any fetch", async () => {
    const m = mountBundle(payload());
    try {
      await waitFor(() => expect(screen.getByTestId("cascade-concept-onto-1")).toBeDefined());
      fireEvent.click(screen.getByTestId("cascade-concept-onto-1"));
      const peek = await screen.findByTestId("cascade-concept-peek");
      await waitFor(() =>
        expect(peek.textContent).toContain("The WFA clause ontology, captured offline."),
      );
      expect(peek.textContent).toContain("wfa-ontology");
      // No workspace offline → no graph deep link.
      expect(screen.queryByTestId("node-peek-view-in-graph")).toBeNull();
      expect(m.fetchCount()).toBe(0);
    } finally {
      m.restore();
    }
  });

  it("says so when a concept was not captured", async () => {
    const m = mountBundle(payload());
    try {
      await waitFor(() => expect(screen.getByTestId("cascade-concept-cc-1")).toBeDefined());
      fireEvent.click(screen.getByTestId("cascade-concept-cc-1"));
      const peek = await screen.findByTestId("cascade-concept-peek");
      expect(peek.textContent).toContain("not captured when the trace was exported");
      expect(m.fetchCount()).toBe(0);
    } finally {
      m.restore();
    }
  });
});
