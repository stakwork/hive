import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceLearningSettings } from "@/components/settings/VoiceLearningSettings";
import { toast } from "sonner";
import * as VoiceLearningPreference from "@/hooks/useVoiceLearningPreference";

vi.mock("sonner");
vi.mock("@/hooks/useVoiceLearningPreference", () => ({
  resetVoiceLearningCache: vi.fn(),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, disabled, id }: any) => (
    <button
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      disabled={disabled}
      data-testid="voice-learning-switch"
    />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

describe("VoiceLearningSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders with toggle off when voiceLearningEnabled=false from the API", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ voiceLearningEnabled: false }),
    });

    render(<VoiceLearningSettings />);

    await waitFor(() => {
      const toggle = screen.getByTestId("voice-learning-switch");
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("renders with toggle on when voiceLearningEnabled=true from the API", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ voiceLearningEnabled: true }),
    });

    render(<VoiceLearningSettings />);

    await waitFor(() => {
      const toggle = screen.getByTestId("voice-learning-switch");
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("clicking toggle calls PATCH /api/user/preferences with { voiceLearningEnabled: true }", async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: true }),
      });

    render(<VoiceLearningSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("voice-learning-switch")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("voice-learning-switch"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/user/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ voiceLearningEnabled: true }),
        })
      );
    });
  });

  it("on success calls resetVoiceLearningCache and shows success toast", async () => {
    const user = userEvent.setup();
    const resetSpy = vi.spyOn(VoiceLearningPreference, "resetVoiceLearningCache");

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: true }),
      });

    render(<VoiceLearningSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("voice-learning-switch")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("voice-learning-switch"));

    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("Preference saved");
    });
  });

  it("on API error shows error toast and reverts toggle to previous state", async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voiceLearningEnabled: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

    render(<VoiceLearningSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("voice-learning-switch")).not.toBeDisabled();
    });

    await user.click(screen.getByTestId("voice-learning-switch"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to save preference");
      // Toggle should be reverted back to false
      expect(screen.getByTestId("voice-learning-switch")).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });
  });
});
