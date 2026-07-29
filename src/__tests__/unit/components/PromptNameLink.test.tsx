/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "test-ws" }),
}));

vi.mock("lucide-react", () => ({
  ExternalLink: ({ className }: { className?: string }) => (
    <svg data-testid="external-link-icon" className={className} />
  ),
}));

const mockWindowOpen = vi.fn();
Object.defineProperty(window, "open", { writable: true, value: mockWindowOpen });

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeVersionsResponse(
  versions: Array<{ id: string; version_number: number }>,
  ok = true,
) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 403,
    json: () =>
      Promise.resolve({
        success: true,
        data: { versions },
      }),
  } as Response);
}

// ─── Import after mocks ──────────────────────────────────────────────────────

import {
  PromptNameLink,
  VersionRefLink,
} from "@/components/prompts/PromptNameLink";

// ─── PromptNameLink tests ────────────────────────────────────────────────────

describe("PromptNameLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders the prompt name and ExternalLink icon", () => {
    render(<PromptNameLink name="MY_PROMPT" promptId="prompt-1" />);
    expect(screen.getByText("MY_PROMPT")).toBeInTheDocument();
    expect(screen.getByTestId("external-link-icon")).toBeInTheDocument();
  });

  test("click calls window.open with the correct URL immediately (no fetch)", () => {
    // PromptNameLink is synchronous — track fetch calls via a spy
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    render(<PromptNameLink name="MY_PROMPT" promptId="prompt-123" />);
    fireEvent.click(screen.getByRole("button"));

    expect(mockWindowOpen).toHaveBeenCalledOnce();
    expect(mockWindowOpen).toHaveBeenCalledWith(
      "/w/test-ws/prompts?prompt=prompt-123",
      "_blank",
      "noopener,noreferrer",
    );
    // PromptNameLink never fires a fetch — promptId is already known
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("button is not disabled", () => {
    render(<PromptNameLink name="MY_PROMPT" promptId="prompt-1" />);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});

// ─── VersionRefLink tests ────────────────────────────────────────────────────

describe("VersionRefLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders the label and ExternalLink icon", () => {
    render(
      <VersionRefLink label="version 3" versionNumber={3} promptId="p1" />,
    );
    expect(screen.getByText("version 3")).toBeInTheDocument();
    expect(screen.getByTestId("external-link-icon")).toBeInTheDocument();
  });

  test("click fetches versions, matches version_number, opens version URL", async () => {
    global.fetch = vi.fn(() =>
      makeVersionsResponse([
        { id: "v3id", version_number: 3 },
        { id: "v2id", version_number: 2 },
      ]),
    ) as unknown as typeof fetch;

    render(
      <VersionRefLink label="version 3" versionNumber={3} promptId="p-abc" />,
    );
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(mockWindowOpen).toHaveBeenCalledOnce());

    expect(global.fetch).toHaveBeenCalledWith("/api/workflow/prompts/p-abc/versions");
    expect(mockWindowOpen).toHaveBeenCalledWith(
      "/w/test-ws/prompts?prompt=p-abc&version=v3id",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("falls back to prompt-only URL on 403 from versions endpoint", async () => {
    global.fetch = vi.fn(() => makeVersionsResponse([], false)) as unknown as typeof fetch;

    render(
      <VersionRefLink label="version 2" versionNumber={2} promptId="p-xyz" />,
    );
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(mockWindowOpen).toHaveBeenCalledOnce());

    expect(mockWindowOpen).toHaveBeenCalledWith(
      "/w/test-ws/prompts?prompt=p-xyz",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("falls back to prompt-only URL when version number not found in list", async () => {
    global.fetch = vi.fn(() =>
      makeVersionsResponse([{ id: "v1id", version_number: 1 }]),
    ) as unknown as typeof fetch;

    render(
      <VersionRefLink label="version 99" versionNumber={99} promptId="p-foo" />,
    );
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(mockWindowOpen).toHaveBeenCalledOnce());

    expect(mockWindowOpen).toHaveBeenCalledWith(
      "/w/test-ws/prompts?prompt=p-foo",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("falls back gracefully on network error (no thrown error)", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch;

    render(
      <VersionRefLink label="version 1" versionNumber={1} promptId="p-net" />,
    );
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(mockWindowOpen).toHaveBeenCalledOnce());

    expect(mockWindowOpen).toHaveBeenCalledWith(
      "/w/test-ws/prompts?prompt=p-net",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("button is disabled while loading", async () => {
    let resolveResponse!: (value: unknown) => void;
    global.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    ) as unknown as typeof fetch;

    render(
      <VersionRefLink label="version 5" versionNumber={5} promptId="p-slow" />,
    );
    const button = screen.getByRole("button");
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    // While fetch is in-flight the button should be disabled
    await waitFor(() => expect(button).toBeDisabled());

    // Unblock the fetch
    resolveResponse({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, data: { versions: [{ id: "v5id", version_number: 5 }] } }),
    });

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(mockWindowOpen).toHaveBeenCalledOnce();
  });

  test("second click uses cached URL without re-fetching", async () => {
    global.fetch = vi.fn(() =>
      makeVersionsResponse([{ id: "v2id", version_number: 2 }]),
    ) as unknown as typeof fetch;

    render(
      <VersionRefLink label="version 2" versionNumber={2} promptId="p-cache" />,
    );
    const button = screen.getByRole("button");

    // First click
    fireEvent.click(button);
    await waitFor(() => expect(mockWindowOpen).toHaveBeenCalledOnce());
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second click — should not fetch again
    fireEvent.click(button);
    await waitFor(() => expect(mockWindowOpen).toHaveBeenCalledTimes(2));
    expect(global.fetch).toHaveBeenCalledTimes(1); // still 1
  });
});
