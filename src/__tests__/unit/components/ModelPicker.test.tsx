import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelPicker } from "@/app/org/[githubLogin]/_components/ModelPicker";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const MODELS = [
  { id: "1", name: "Claude Sonnet", provider: "anthropic", providerLabel: "Anthropic", model: "sonnet" },
  { id: "2", name: "GPT Five", provider: "openai", providerLabel: "OpenAI", model: "gpt5" },
];

function stubFetch(chatAgentModel: string | null) {
  const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url === "/api/llm-models") return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: MODELS }) });
    if (opts?.method === "PATCH") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ chatAgentModel }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// cmdk needs these jsdom lacks.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

describe("ModelPicker", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.stubGlobal("fetch", undefined));

  it("shows Default when the user has no choice", async () => {
    stubFetch(null);
    render(<ModelPicker />);
    await waitFor(() => expect(screen.getByTestId("model-chip").textContent).toContain("Default"));
  });

  it("shows the selected model's name", async () => {
    const { getModelValue } = await import("@/lib/ai/models");
    stubFetch(getModelValue(MODELS[1] as never));
    render(<ModelPicker />);
    await waitFor(() => expect(screen.getByTestId("model-chip").textContent).toContain("GPT Five"));
  });

  it("lists Default first with the note, and Default sends null", async () => {
    const { getModelValue } = await import("@/lib/ai/models");
    const fetchMock = stubFetch(getModelValue(MODELS[0] as never));
    render(<ModelPicker />);
    await waitFor(() => expect(screen.getByTestId("model-chip").textContent).toContain("Claude Sonnet"));
    const user = userEvent.setup();
    await user.click(screen.getByTestId("model-chip"));
    expect(await screen.findByText("Applies to all your chats, in every org.")).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toBe("Default");
    await user.click(options[0]);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(JSON.parse(patch![1].body)).toEqual({ chatAgentModel: null });
    });
  });
});
