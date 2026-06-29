import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

// Mock hooks and modules before importing component
vi.mock("@/hooks/useVoiceLearningPreference", () => ({
  resetVoiceLearningCache: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, disabled, "aria-label": label }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      data-testid="voice-learning-switch"
    />
  ),
}));

import { VoiceLearningSettings } from "@/app/profile/_components/VoiceLearningSettings";
import { resetVoiceLearningCache } from "@/hooks/useVoiceLearningPreference";
import { toast } from "sonner";

describe("VoiceLearningSettings", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches current preference on mount and renders the switch", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ voiceLearningEnabled: false }),
    } as Response);

    render(<VoiceLearningSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("voice-learning-switch")).toBeTruthy();
    });

    expect(screen.getByText("Voice Correction Learning")).toBeTruthy();
  });

  it("calls PATCH /api/user/preferences with voiceLearningEnabled: true when toggled on", async () => {
    // GET returns false
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: false }),
      } as Response)
      // PATCH succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: true }),
      } as Response);

    render(<VoiceLearningSettings />);

    // Wait for initial fetch to complete
    await waitFor(() => {
      const switchEl = screen.getByTestId("voice-learning-switch");
      expect(switchEl).not.toBeDisabled();
    });

    const switchEl = screen.getByTestId("voice-learning-switch");
    await act(async () => {
      fireEvent.click(switchEl);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const patchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(patchCall[0]).toBe("/api/user/preferences");
    expect(patchCall[1]).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    const body = JSON.parse(patchCall[1].body);
    expect(body.voiceLearningEnabled).toBe(true);
  });

  it("calls PATCH /api/user/preferences with voiceLearningEnabled: false when toggled off", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: false }),
      } as Response);

    render(<VoiceLearningSettings />);

    await waitFor(() => {
      const switchEl = screen.getByTestId("voice-learning-switch");
      expect(switchEl.getAttribute("aria-checked")).toBe("true");
    });

    const switchEl = screen.getByTestId("voice-learning-switch");
    await act(async () => {
      fireEvent.click(switchEl);
    });

    await waitFor(() => {
      const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body);
      expect(body.voiceLearningEnabled).toBe(false);
    });
  });

  it("calls resetVoiceLearningCache after a successful toggle", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: false }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: true }),
      } as Response);

    render(<VoiceLearningSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("voice-learning-switch")).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("voice-learning-switch"));
    });

    await waitFor(() => {
      expect(resetVoiceLearningCache).toHaveBeenCalledOnce();
    });
  });

  it("shows error toast when PATCH fails", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: false }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      } as Response);

    render(<VoiceLearningSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("voice-learning-switch")).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("voice-learning-switch"));
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update preference");
    });
  });
});
