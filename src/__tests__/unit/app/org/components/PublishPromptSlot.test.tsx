// @vitest-environment jsdom
/**
 * Unit tests for PublishPromptSlot, derivePublishState, and resolveLegacyVersion.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  derivePublishState,
  resolveLegacyVersion,
  PublishPromptSlot,
  type VersionStateEntry,
  type VersionStateResponse,
} from "@/app/org/[githubLogin]/_components/PublishPromptSlot";

// ── Mock fetch ────────────────────────────────────────────────────────────────

let mockFetchResponse: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 200,
  body: null,
};

vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
  ok: mockFetchResponse.ok,
  status: mockFetchResponse.status,
  json: async () => mockFetchResponse.body,
})));

// ── Mock Button ───────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVersions(entries: Partial<VersionStateEntry>[]): VersionStateEntry[] {
  return entries.map((e, i) => ({
    id: e.id ?? `v${i + 1}`,
    version_number: e.version_number ?? i + 1,
    published: e.published ?? false,
    created_at: e.created_at ?? new Date(1000 * (i + 1)).toISOString(),
    source: e.source ?? "UI",
  }));
}

function makeData(
  versions: VersionStateEntry[],
  publishedVersionId: string | null,
): VersionStateResponse["data"] {
  return {
    prompt_id: "prompt-1",
    versions,
    current_version_id: versions[0]?.id ?? null,
    published_version_id: publishedVersionId,
  };
}

const BASE_TIMESTAMP = new Date("2024-01-01T12:00:00Z");

// ── derivePublishState ────────────────────────────────────────────────────────

describe("derivePublishState", () => {
  it("returns hidden when no targetVersionId", () => {
    const data = makeData([], null);
    expect(derivePublishState(null, data)).toEqual({ kind: "hidden" });
    expect(derivePublishState(undefined, data)).toEqual({ kind: "hidden" });
    expect(derivePublishState("", data)).toEqual({ kind: "hidden" });
  });

  it("returns hidden when no data", () => {
    expect(derivePublishState("v1", null)).toEqual({ kind: "hidden" });
  });

  it("returns published when targetVersionId === published_version_id", () => {
    const versions = makeVersions([{ id: "v1", version_number: 1, published: true }]);
    const data = makeData(versions, "v1");
    expect(derivePublishState("v1", data)).toEqual({ kind: "published" });
  });

  it("published keys off published_version_id, NOT the per-version published boolean", () => {
    // v1 has published=true in the list but published_version_id points elsewhere
    const versions = makeVersions([
      { id: "v1", version_number: 1, published: true },
      { id: "v2", version_number: 2, published: false },
    ]);
    const data = makeData(versions, "v2"); // published_version_id = v2
    // v1 is in the list with published=true but published_version_id is v2
    expect(derivePublishState("v1", data)).toEqual({ kind: "superseded", latestVersionNumber: 2 });
  });

  it("returns publishable when target is unpublished and no newer version", () => {
    const versions = makeVersions([{ id: "v2", version_number: 2, published: false }]);
    const data = makeData(versions, "v1");
    expect(derivePublishState("v2", data)).toEqual({ kind: "publishable" });
  });

  it("returns superseded when target is unpublished and a newer version exists", () => {
    const versions = makeVersions([
      { id: "v2", version_number: 2, published: false },
      { id: "v3", version_number: 3, published: false },
    ]);
    const data = makeData(versions, "v1");
    expect(derivePublishState("v2", data)).toEqual({ kind: "superseded", latestVersionNumber: 3 });
  });

  it("returns unresolved when target id is absent from the list", () => {
    const versions = makeVersions([{ id: "v1", version_number: 1 }]);
    const data = makeData(versions, null);
    expect(derivePublishState("v99", data)).toEqual({ kind: "unresolved" });
  });
});

// ── resolveLegacyVersion ──────────────────────────────────────────────────────

describe("resolveLegacyVersion", () => {
  const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

  function makeEntry(source: string, createdAt: Date, id: string): VersionStateEntry {
    return {
      id,
      version_number: 1,
      published: false,
      created_at: createdAt.toISOString(),
      source,
    };
  }

  it("resolves exactly one MCP candidate within the window", () => {
    const approvalTs = new Date("2024-01-01T12:10:00Z");
    const createdAt = new Date("2024-01-01T12:05:00Z"); // 5 min before
    const versions = [makeEntry("MCP", createdAt, "v1")];
    const result = resolveLegacyVersion(versions, approvalTs, WINDOW_MS);
    expect(result?.id).toBe("v1");
  });

  it("returns null when zero MCP candidates in window", () => {
    const approvalTs = new Date("2024-01-01T12:10:00Z");
    const createdAt = new Date("2024-01-01T11:00:00Z"); // 70 min before — outside window
    const versions = [makeEntry("MCP", createdAt, "v1")];
    const result = resolveLegacyVersion(versions, approvalTs, WINDOW_MS);
    expect(result).toBeNull();
  });

  it("returns null when two MCP candidates in window (ambiguous)", () => {
    const approvalTs = new Date("2024-01-01T12:10:00Z");
    const versions = [
      makeEntry("MCP", new Date("2024-01-01T12:05:00Z"), "v1"),
      makeEntry("MCP", new Date("2024-01-01T12:08:00Z"), "v2"),
    ];
    const result = resolveLegacyVersion(versions, approvalTs, WINDOW_MS);
    expect(result).toBeNull();
  });

  it("does NOT select a non-MCP version even if in window", () => {
    const approvalTs = new Date("2024-01-01T12:10:00Z");
    const versions = [
      makeEntry("UI", new Date("2024-01-01T12:05:00Z"), "v1"), // UI source — should not be selected
    ];
    const result = resolveLegacyVersion(versions, approvalTs, WINDOW_MS);
    expect(result).toBeNull();
  });

  it("does NOT select a candidate created after approval timestamp", () => {
    const approvalTs = new Date("2024-01-01T12:10:00Z");
    const versions = [
      makeEntry("MCP", new Date("2024-01-01T12:15:00Z"), "v1"), // after approval — excluded
    ];
    const result = resolveLegacyVersion(versions, approvalTs, WINDOW_MS);
    expect(result).toBeNull();
  });

  it("ignores non-MCP versions alongside a valid MCP candidate", () => {
    const approvalTs = new Date("2024-01-01T12:10:00Z");
    const versions = [
      makeEntry("MCP", new Date("2024-01-01T12:05:00Z"), "v2"),
      makeEntry("UI", new Date("2024-01-01T12:08:00Z"), "v3"), // UI — excluded
    ];
    const result = resolveLegacyVersion(versions, approvalTs, WINDOW_MS);
    expect(result?.id).toBe("v2");
  });
});

// ── PublishPromptSlot renders ─────────────────────────────────────────────────

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

describe("PublishPromptSlot renders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the default stub implementation (reading from mockFetchResponse).
    // Tests that call mockImplementation() replace the stub; clearAllMocks()
    // only resets call history, not the implementation, so subsequent tests
    // would inherit the previous test's custom implementation.
    vi.mocked(globalThis.fetch).mockImplementation(async (_url: string) => ({
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.status,
      json: async () => mockFetchResponse.body,
    }) as any);
  });

  async function renderSlot(props: Partial<Parameters<typeof PublishPromptSlot>[0]> = {}) {
    const defaultProps = {
      promptId: "prompt-1",
      promptVersionId: "v2",
      workspaceSlug: "stakwork",
      approvalTimestamp: BASE_TIMESTAMP,
      onStateChange: vi.fn(),
      ...props,
    };
    const result = render(<PublishPromptSlot {...defaultProps} />);
    // Let effects run
    await act(async () => {
      await Promise.resolve();
    });
    return result;
  }

  it("renders Publish button for publishable state", async () => {
    const versions = makeVersions([
      { id: "v1", version_number: 1, published: true },
      { id: "v2", version_number: 2, published: false },
    ]);
    mockFetchResponse = { ok: true, status: 200, body: makeSuccessResponse(versions, "v1") };
    await renderSlot({ promptVersionId: "v2" });
    await waitFor(() => expect(screen.getByText("Publish")).toBeTruthy());
    expect(screen.queryByText(/A newer draft/)).toBeNull();
  });

  it("renders Publish button + warning for superseded state", async () => {
    const versions = makeVersions([
      { id: "v1", version_number: 1, published: true },
      { id: "v2", version_number: 2, published: false },
      { id: "v3", version_number: 3, published: false },
    ]);
    mockFetchResponse = { ok: true, status: 200, body: makeSuccessResponse(versions, "v1") };
    await renderSlot({ promptVersionId: "v2" });
    await waitFor(() => expect(screen.getByText("Publish")).toBeTruthy());
    expect(screen.getByText(/A newer draft \(v3\)/)).toBeTruthy();
  });

  it("renders Published checkmark + deep link for published state", async () => {
    const versions = makeVersions([{ id: "v2", version_number: 2, published: true }]);
    mockFetchResponse = { ok: true, status: 200, body: makeSuccessResponse(versions, "v2") };
    await renderSlot({ promptVersionId: "v2", workspaceSlug: "my-workspace" });
    await waitFor(() => expect(screen.getByText(/Published ✓/)).toBeTruthy());
    // Deep link should point to correct workspace
    const link = screen.getByTitle("View in prompt library") as HTMLAnchorElement;
    expect(link.href).toContain("/w/my-workspace/prompts");
    expect(link.href).toContain("prompt=prompt-1");
    expect(screen.queryByText("Publish")).toBeNull();
  });

  it("renders read-only text for unresolved state (version not in list)", async () => {
    const versions = makeVersions([{ id: "v1", version_number: 1 }]);
    mockFetchResponse = { ok: true, status: 200, body: makeSuccessResponse(versions, null) };
    await renderSlot({ promptVersionId: "v99" }); // v99 not in list
    await waitFor(() =>
      expect(screen.getByText(/Draft version saved — not published/)).toBeTruthy(),
    );
    expect(screen.queryByText("Publish")).toBeNull();
  });

  it("renders 403 read-only text and no Publish button", async () => {
    mockFetchResponse = { ok: false, status: 403, body: {} };
    await renderSlot();
    await waitFor(() =>
      expect(screen.getByText(/Draft version saved — not published/)).toBeTruthy(),
    );
    expect(screen.getByText(/Publishing requires prompt library access/)).toBeTruthy();
    expect(screen.queryByText("Publish")).toBeNull();
  });

  it("renders nothing on 404 (prompt deleted)", async () => {
    mockFetchResponse = { ok: false, status: 404, body: {} };
    const { container } = await renderSlot();
    await waitFor(() => {
      expect(container.textContent).toBe("");
    });
  });

  it("appends sync-pending note when PUSH_FAILED after publish", async () => {
    const versions = makeVersions([{ id: "v2", version_number: 2 }]);
    // Initial fetch — publishable state
    mockFetchResponse = { ok: true, status: 200, body: makeSuccessResponse(versions, "v1") };
    await renderSlot({ promptVersionId: "v2" });
    await waitFor(() => expect(screen.getByText("Publish")).toBeTruthy());

    // Mock publish → success with PUSH_FAILED
    // Then re-fetch → published
    const publishedVersions = makeVersions([{ id: "v2", version_number: 2, published: true }]);
    let fetchCallCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (url: string) => {
      fetchCallCount++;
      if (String(url).includes("/publish")) {
        return { ok: true, status: 200, json: async () => ({ syncOutcome: "PUSH_FAILED" }) } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => makeSuccessResponse(publishedVersions, "v2"),
      } as any;
    });

    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() =>
      expect(screen.getByText(/Published ✓/)).toBeTruthy(),
    );
    expect(screen.getByText(/sync to Stakwork pending retry/)).toBeTruthy();
  });

  it("does NOT show sync note when NOT_CONFIGURED", async () => {
    const versions = makeVersions([{ id: "v2", version_number: 2 }]);
    mockFetchResponse = { ok: true, status: 200, body: makeSuccessResponse(versions, "v1") };
    await renderSlot({ promptVersionId: "v2" });
    await waitFor(() => expect(screen.getByText("Publish")).toBeTruthy());

    const publishedVersions = makeVersions([{ id: "v2", version_number: 2, published: true }]);
    vi.mocked(globalThis.fetch).mockImplementation(async (url: string) => {
      if (String(url).includes("/publish")) {
        return { ok: true, status: 200, json: async () => ({ syncOutcome: "NOT_CONFIGURED" }) } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => makeSuccessResponse(publishedVersions, "v2"),
      } as any;
    });

    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(screen.getByText(/Published ✓/)).toBeTruthy());
    expect(screen.queryByText(/sync to Stakwork/)).toBeNull();
  });

  it("on 409 refetches and re-renders with fresh warning, not generic error", async () => {
    const versionsV2 = makeVersions([{ id: "v2", version_number: 2 }]);
    // Initial: publishable
    mockFetchResponse = { ok: true, status: 200, body: makeSuccessResponse(versionsV2, "v1") };
    await renderSlot({ promptVersionId: "v2" });
    await waitFor(() => expect(screen.getByText("Publish")).toBeTruthy());

    // Publish → 409; refetch → superseded
    const versionsV3 = makeVersions([
      { id: "v2", version_number: 2 },
      { id: "v3", version_number: 3 },
    ]);
    vi.mocked(globalThis.fetch).mockImplementation(async (url: string) => {
      if (String(url).includes("/publish")) {
        return { ok: false, status: 409, json: async () => ({}) } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => makeSuccessResponse(versionsV3, "v1"),
      } as any;
    });

    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(screen.getByText(/A newer draft \(v3\)/)).toBeTruthy());
    // Still shows Publish, not a generic error
    expect(screen.getByText("Publish")).toBeTruthy();
  });

  it("focus-refetch dedupe fires at most once inside the dedup window", async () => {
    const versions = makeVersions([{ id: "v2", version_number: 2 }]);
    mockFetchResponse = { ok: true, status: 200, body: makeSuccessResponse(versions, "v1") };
    const fetchSpy = vi.mocked(globalThis.fetch);

    await renderSlot({ promptVersionId: "v2" });
    await waitFor(() => expect(screen.getByText("Publish")).toBeTruthy());

    const callsAfterMount = fetchSpy.mock.calls.length;

    // Focus event within dedup window — should be ignored
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => { await Promise.resolve(); });

    // No new calls within dedup window
    expect(fetchSpy.mock.calls.length).toBe(callsAfterMount);
  });
});
