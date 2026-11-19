/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { ArtifactPanel } from "@/app/org/[githubLogin]/_components/artifacts/ArtifactPanel";
import { artifactShareUrl } from "@/app/org/[githubLogin]/_components/artifacts/shareLink";
import { artifactIdentity, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const writeText = vi.fn().mockResolvedValue(undefined);

function open(artifact: ArtifactRef) {
  act(() => useCanvasChatStore.getState().openLiveArtifact(artifact));
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ArtifactPanel />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const inline = (kind: ArtifactRef["kind"], content: Record<string, unknown>): ArtifactRef => ({
  id: `${kind}-1`,
  kind,
  title: "Thing",
  source: { type: "inline", content },
});

describe("Share menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("Copy Link copies the share url and toasts", async () => {
    const artifact = inline("markdown", { text: "# hi" });
    open(artifact);
    const user = userEvent.setup();
    // userEvent.setup installs its own clipboard stub; put the spy back.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByRole("menuitem", { name: "Download PDF" })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Copy Link" }));
    expect(writeText).toHaveBeenCalledWith(artifactShareUrl(window.location.href, artifactIdentity(artifact)));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link copied"));
  });

  it("hides Download PDF for video", async () => {
    open(inline("video", { url: "/v.mp4" }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByRole("menuitem", { name: "Copy Link" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Download PDF" })).toBeNull();
  });
});
