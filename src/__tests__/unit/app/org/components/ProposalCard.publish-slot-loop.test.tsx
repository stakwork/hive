// @vitest-environment jsdom
/**
 * Regression test for the PublishPromptSlot <-> ProposalCard render loop.
 *
 * Root cause: `PublishPromptSlot` derived `publishState` as a fresh object
 * literal on every render (`derivePublishState(...)`), and an effect with
 * `[publishState, fetchError]` deps called `onStateChange` every time that
 * reference changed — i.e. every render. `ProposalCard` wired
 * `onStateChange={setSlotPublishState}` directly, so each call created a new
 * state value, which re-rendered `ProposalCard`, which re-rendered the slot,
 * which fired the effect again — forever.
 *
 * This harness mirrors the real wiring (`const [s, setS] = useState(); <PublishPromptSlot
 * onStateChange={setS} />`) using the REAL `PublishPromptSlot` component, and
 * asserts the render count stays bounded via React's Profiler API.
 */

import React, { Profiler, useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  PublishPromptSlot,
  type PublishState,
  type VersionStateEntry,
  type VersionStateResponse,
} from "@/app/org/[githubLogin]/_components/PublishPromptSlot";

// ── Mock Button (same shim used by PublishPromptSlot.test.tsx) ───────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

// ── Fetch mock ────────────────────────────────────────────────────────────────

function makeVersions(entries: Partial<VersionStateEntry>[]): VersionStateEntry[] {
  return entries.map((e, i) => ({
    id: e.id ?? `v${i + 1}`,
    version_number: e.version_number ?? i + 1,
    published: e.published ?? false,
    created_at: e.created_at ?? new Date(1000 * (i + 1)).toISOString(),
    source: e.source ?? "UI",
  }));
}

function makeSuccessResponse(
  versions: VersionStateEntry[],
  publishedVersionId: string | null,
): VersionStateResponse {
  return {
    success: true,
    data: {
      prompt_id: "prompt-1",
      versions,
      current_version_id: versions[0]?.id ?? null,
      published_version_id: publishedVersionId,
    },
  };
}

const BASE_TIMESTAMP = new Date("2024-01-01T00:00:00.000Z");

beforeEach(() => {
  const versions = makeVersions([
    { id: "v1", version_number: 1, published: true },
    { id: "v2", version_number: 2, published: false },
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => makeSuccessResponse(versions, "v1"),
    })),
  );
});

/**
 * Minimal harness that mirrors how `ProposalCard` wires up the slot:
 *
 *   const [s, setS] = useState<PublishState | null>(null);
 *   <PublishPromptSlot onStateChange={setS} />
 *
 * Wrapped in a `Profiler` so we can count how many times the harness
 * (standing in for `ProposalCard`) actually commits a render.
 */
function Harness({ onRenderCommit }: { onRenderCommit: () => void }) {
  const [, setState] = useState<PublishState | null>(null);
  return (
    <Profiler id="harness" onRender={onRenderCommit}>
      <PublishPromptSlot
        promptId="prompt-1"
        promptVersionId="v2"
        workspaceSlug="stakwork"
        approvalTimestamp={BASE_TIMESTAMP}
        onStateChange={setState}
      />
    </Profiler>
  );
}

describe("PublishPromptSlot + ProposalCard-style wiring (render-loop regression)", () => {
  it("settles to a bounded number of renders instead of looping forever", async () => {
    let renderCount = 0;
    render(<Harness onRenderCommit={() => renderCount++} />);

    // Let the initial fetch + effects + any follow-on state updates settle.
    await waitFor(() => expect(screen.getByText("Publish")).toBeTruthy());

    // Drain a handful of extra microtask/macrotask turns — a runaway loop
    // would keep incrementing renderCount indefinitely across these.
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    // A healthy mount does a small, fixed number of renders (initial render,
    // loading flag flip, data arrival, derived-state settle). A runaway loop
    // would blow well past this within the drain loop above.
    expect(renderCount).toBeLessThan(10);
  });
});
