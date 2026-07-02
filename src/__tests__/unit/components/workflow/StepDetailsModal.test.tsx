// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepDetailsModal } from "@/components/StepDetailsModal";
import type { WorkflowTransition } from "@/types/stakwork/workflow";

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: React.ReactNode;
  }) => {
    const items: { value: string; label: string }[] = [];
    React.Children.forEach(children, (child: any) => {
      if (child?.props?.children) {
        React.Children.forEach(child.props.children, (item: any) => {
          if (item?.props?.value !== undefined) {
            items.push({ value: item.props.value, label: item.props.children });
          }
        });
      }
    });
    return (
      <select
        data-testid="step-agent-select"
        value={value ?? ""}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {items.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
      </select>
    );
  },
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

const { CREATE_NEW_VALUE } = vi.hoisted(() => ({ CREATE_NEW_VALUE: "__create_new__" }));

vi.mock("@/components/evals/CaptureEvalForm", () => ({
  CREATE_NEW_VALUE,
  CaptureEvalForm: ({
    requirement,
    reason,
    onRequirementChange,
    onReasonChange,
    submitting,
    evalSets,
    loadingEvalSets,
    evalSetsError,
    selectedEvalSetId,
    onSelectEvalSet,
    newEvalSetName,
    onNewEvalSetNameChange,
  }: {
    requirement: string;
    reason: string;
    onRequirementChange: (v: string) => void;
    onReasonChange: (v: string) => void;
    submitting?: boolean;
    evalSets: Array<{ ref_id: string; name: string }>;
    loadingEvalSets: boolean;
    evalSetsError: boolean;
    selectedEvalSetId: string;
    onSelectEvalSet: (id: string) => void;
    newEvalSetName: string;
    onNewEvalSetNameChange: (name: string) => void;
  }) => (
    <div data-testid="capture-eval-form">
      {loadingEvalSets && <span data-testid="eval-sets-loading">Loading...</span>}
      {evalSetsError && <span data-testid="eval-sets-error">Failed to load eval sets</span>}
      {evalSets.map((es) => (
        <button
          key={es.ref_id}
          data-testid={`eval-set-option-${es.ref_id}`}
          onClick={() => onSelectEvalSet(es.ref_id)}
        >
          {es.name}
        </button>
      ))}
      <button
        data-testid="eval-set-create-new"
        onClick={() => onSelectEvalSet(CREATE_NEW_VALUE)}
      >
        + Create new
      </button>
      {selectedEvalSetId === CREATE_NEW_VALUE && (
        <input
          aria-label="New eval set name"
          value={newEvalSetName}
          onChange={(e) => onNewEvalSetNameChange(e.target.value)}
        />
      )}
      <input
        aria-label="Requirement"
        value={requirement}
        onChange={(e) => onRequirementChange(e.target.value)}
        disabled={submitting}
      />
      <input
        aria-label="Reason"
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        disabled={submitting}
      />
    </div>
  ),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a WorkflowTransition that isLlmStep recognises as an LLM step */
function makeLlmStep(overrides: Partial<WorkflowTransition> = {}): WorkflowTransition {
  return {
    id: "step-llm",
    name: "generate_response",
    display_name: "Generate Response",
    display_id: "step-llm",
    step_type: "automated",
    url: "https://api.openai.com/v1/chat/completions",
    ...overrides,
  } as WorkflowTransition;
}

function makeStep(overrides: Partial<WorkflowTransition> = {}): WorkflowTransition {
  return {
    id: "step-1",
    name: "my_step",
    display_name: "My Step",
    display_id: "step-1",
    step_type: "automated",
    ...overrides,
  } as WorkflowTransition;
}

function defaultProps(overrides: Partial<React.ComponentProps<typeof StepDetailsModal>> = {}) {
  return {
    step: makeStep(),
    isOpen: true,
    onClose: vi.fn(),
    ...overrides,
  };
}

const mockEvalSetsResponse = {
  success: true,
  data: {
    nodes: [
      { ref_id: "set-1", properties: { name: "Eval Set Alpha" } },
      { ref_id: "set-2", properties: { name: "Eval Set Beta" } },
    ],
    total: 2,
  },
};

// ── StepDetailsModal render ───────────────────────────────────────────────────

describe("StepDetailsModal — overlay and sizing", () => {
  it("uses fixed positioning for the overlay", () => {
    const { container } = render(<StepDetailsModal {...defaultProps()} />);
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).not.toContain("absolute");
  });

  it("constrains the inner dialog width and height", () => {
    const { container } = render(<StepDetailsModal {...defaultProps()} />);
    const overlay = container.firstChild as HTMLElement;
    const dialog = overlay.firstChild as HTMLElement;
    expect(dialog.className).toContain("max-w-3xl");
    expect(dialog.className).toContain("max-h-[85vh]");
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <StepDetailsModal {...defaultProps({ isOpen: false })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when step is null", () => {
    const { container } = render(
      <StepDetailsModal {...defaultProps({ step: null })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("displays the step display_name in the header", () => {
    render(
      <StepDetailsModal {...defaultProps({ step: makeStep({ display_name: "Deploy Service" }) })} />,
    );
    expect(screen.getByText("Deploy Service")).toBeDefined();
  });
});

// ── Tab switching does not close the modal ────────────────────────────────────

describe("StepDetailsModal — tab clicks do not close the modal", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: null }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not call onClose when clicking the Inputs tab", async () => {
    const onClose = vi.fn();
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={onClose} />);

    await userEvent.click(screen.getByRole("tab", { name: "Inputs" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when clicking the Outputs tab", async () => {
    const onClose = vi.fn();
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={onClose} />);

    await userEvent.click(screen.getByRole("tab", { name: "Outputs" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when clicking the Logs tab", async () => {
    const onClose = vi.fn();
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={onClose} />);

    await userEvent.click(screen.getByRole("tab", { name: "Logs" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when clicking the Prompts tab", async () => {
    const onClose = vi.fn();
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={onClose} />);

    await userEvent.click(screen.getByRole("tab", { name: "Prompts" }));

    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── IO endpoint fetching ──────────────────────────────────────────────────────

describe("StepDetailsModal — IO endpoint", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ data: { inputs: { foo: "bar" }, outputs: { baz: "qux" } } }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("fetches IO using step.id", async () => {
    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1", name: "my_step" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/proj-1/steps/step-1/io",
      );
    });
  });

  it("fetches IO using step.id even when run transitions provide project_step_id", async () => {
    const runTransitions: Record<string, WorkflowTransition> = {
      "step-1": makeStep({ id: "step-1", name: "my_step", project_step_id: "psid-123" }),
    };
    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1", name: "my_step" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
        runTransitions={runTransitions}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/proj-1/steps/step-1/io",
      );
    });
  });

  it("renders IO data when fetch returns { data: { inputs, outputs } }", async () => {
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({ success: true, data: { inputs: { foo: 1 }, outputs: { bar: 2 } } }),
    });

    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1", name: "my_step" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Inputs" }));
    await waitFor(() => {
      expect(screen.getByText(/\"foo\"/)).toBeDefined();
    });

    await userEvent.click(screen.getByRole("tab", { name: "Outputs" }));
    await waitFor(() => {
      expect(screen.getByText(/\"bar\"/)).toBeDefined();
    });
  });

  it("does not fetch IO when projectId is undefined", async () => {
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={vi.fn()} />);

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── IO tab empty states ───────────────────────────────────────────────────────

describe("StepDetailsModal — IO tab empty states", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows 'Select a run to view IO data.' in Inputs/Outputs when projectId is undefined", async () => {
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Inputs" }));
    expect(screen.getByText("Select a run to view IO data.")).toBeDefined();

    await userEvent.click(screen.getByRole("tab", { name: "Outputs" }));
    expect(screen.getByText("Select a run to view IO data.")).toBeDefined();
  });

  it("shows 'No input data available.' when projectId is set but ioData is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve({ data: null }) }),
    );

    render(
      <StepDetailsModal
        step={makeStep({ name: "my_step" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Inputs" }));
    await waitFor(() => {
      expect(screen.getByText("No input data available.")).toBeDefined();
    });
  });
});

// ── Flag for eval button visibility ──────────────────────────────────────────

describe("StepDetailsModal — Flag for eval button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { inputs: { model: "gpt-4o" }, outputs: "result" } }),
    }));
  });

  it("shows Flag for eval when slug, workflowId, projectId are set and step is LLM", () => {
    render(
      <StepDetailsModal
        {...defaultProps({
          step: makeLlmStep(),
          slug: "my-ws",
          workflowId: "42",
          projectId: "run-123",
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /flag for eval/i })).toBeInTheDocument();
  });

  it("hides Flag for eval when projectId is absent (no active run)", () => {
    render(
      <StepDetailsModal
        {...defaultProps({
          step: makeLlmStep(),
          slug: "my-ws",
          workflowId: "42",
          // no projectId
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /flag for eval/i })).not.toBeInTheDocument();
  });

  it("hides Flag for eval for non-LLM step types", () => {
    render(
      <StepDetailsModal
        {...defaultProps({
          step: makeStep(), // no LLM URL
          slug: "my-ws",
          workflowId: "42",
          projectId: "run-123",
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /flag for eval/i })).not.toBeInTheDocument();
  });

  it("hides Flag for eval when slug is absent", () => {
    render(
      <StepDetailsModal
        {...defaultProps({
          step: makeLlmStep(),
          workflowId: "42",
          projectId: "run-123",
          // no slug
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /flag for eval/i })).not.toBeInTheDocument();
  });
});

// ── Flag for eval capture flow ────────────────────────────────────────────────

describe("StepDetailsModal — Flag for eval capture", () => {
  function makeMultiFetch(overrides: {
    ioResponse?: object;
    evalsResponse?: object;
    captureOk?: boolean;
    createEvalSetResponse?: object;
  } = {}) {
    const {
      ioResponse = { data: { inputs: { model: "gpt-4o" }, outputs: "result" } },
      evalsResponse = mockEvalSetsResponse,
      captureOk = true,
      createEvalSetResponse,
    } = overrides;

    return vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/steps/") && String(url).includes("/io")) {
        return Promise.resolve({ ok: true, json: async () => ioResponse });
      }
      if (String(url).endsWith("/evals")) {
        if (createEvalSetResponse !== undefined) {
          // POST /evals to create new set
          return Promise.resolve({ ok: true, json: async () => createEvalSetResponse });
        }
        return Promise.resolve({ ok: true, json: async () => evalsResponse });
      }
      if (String(url).includes("/eval/capture")) {
        return Promise.resolve({ ok: captureOk, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", makeMultiFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function openFlagForm(fetchMock?: ReturnType<typeof vi.fn>) {
    if (fetchMock) vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step", name: "generate_response" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => expect(screen.getByTestId("capture-eval-form")).toBeInTheDocument());
  }

  it("opens the CaptureEvalForm when Flag for eval is clicked", async () => {
    await openFlagForm();
  });

  it("hides Flag for eval button while form is open", async () => {
    await openFlagForm();
    expect(screen.queryByRole("button", { name: /flag for eval/i })).not.toBeInTheDocument();
  });

  it("renders agentName Select dropdown when flag form is open", async () => {
    await openFlagForm();
    expect(screen.getByTestId("step-agent-select")).toBeInTheDocument();
  });

  it("agentName Select defaults to the first HIVE_AGENT_OPTIONS entry", async () => {
    const { HIVE_AGENT_OPTIONS } = await import("@/lib/utils/hive-agent");
    await openFlagForm();
    const select = screen.getByTestId("step-agent-select") as HTMLSelectElement;
    expect(select.value).toBe(HIVE_AGENT_OPTIONS[0].name);
  });

  it("sends agentName in the capture payload", async () => {
    const { HIVE_AGENT_OPTIONS } = await import("@/lib/utils/hive-agent");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/io")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: { inputs: { model: "gpt-4o" }, outputs: "result" },
          }),
        });
      }
      if (String(url).endsWith("/evals")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              nodes: [{ ref_id: "set-1", properties: { name: "Eval Set Alpha" } }],
              total: 1,
            },
          }),
        });
      }
      if (String(url).includes("/eval/capture")) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await openFlagForm(fetchMock);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]: [string]) => String(url).endsWith("/evals"))).toBe(true),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Must always respond" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      const captureCall = fetchMock.mock.calls.find(([url]: [string]) =>
        String(url).includes("/eval/capture"),
      );
      expect(captureCall).toBeDefined();
      const body = JSON.parse((captureCall![1] as RequestInit).body as string);
      expect(body.agentName).toBe(HIVE_AGENT_OPTIONS[0].name);
    });
  });

  it("changing agentName Select sends the overridden value in the capture payload", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/io")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: { inputs: { model: "gpt-4o" }, outputs: "result" },
          }),
        });
      }
      if (String(url).endsWith("/evals")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              nodes: [{ ref_id: "set-1", properties: { name: "Eval Set Alpha" } }],
              total: 1,
            },
          }),
        });
      }
      if (String(url).includes("/eval/capture")) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await openFlagForm(fetchMock);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]: [string]) => String(url).endsWith("/evals"))).toBe(true),
    );

    // Change agent to canvas-agent
    const select = screen.getByTestId("step-agent-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "canvas-agent" } });
    expect(select.value).toBe("canvas-agent");

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Must always respond" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      const captureCall = fetchMock.mock.calls.find(([url]: [string]) =>
        String(url).includes("/eval/capture"),
      );
      expect(captureCall).toBeDefined();
      const body = JSON.parse((captureCall![1] as RequestInit).body as string);
      expect(body.agentName).toBe("canvas-agent");
    });
  });

  it("fetches eval sets when flag form opens", async () => {
    const fetchMock = makeMultiFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep()}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));

    await waitFor(() => {
      const evalsCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/evals"),
      );
      expect(evalsCalls.length).toBeGreaterThan(0);
      expect(evalsCalls[0][0]).toBe("/api/workspaces/my-ws/evals");
    });
  });

  it("submit button is disabled without a set selected", async () => {
    // Return empty eval sets so nothing is auto-selected
    const fetchMock = makeMultiFetch({
      evalsResponse: { success: true, data: { nodes: [], total: 0 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    // Wait for IO fetch
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/io"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Must return a summary" },
    });

    const captureBtn = screen.getByRole("button", { name: /capture/i });
    expect(captureBtn).toBeDisabled();
  });

  it("submits correct URL and body with evalSetId when existing set is selected", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/io")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              inputs: { model: "gpt-4o", messages: [] },
              outputs: "some output",
              prompt_resolutions: {
                CUSTOM_ENTITY_EXTRACTION_PROMPT: {
                  prompt_id: 1552,
                  prompt_version_id: 789,
                  resolution: { entity_type: "org" },
                },
              },
            },
          }),
        });
      }
      if (String(url).endsWith("/evals")) {
        return Promise.resolve({ ok: true, json: async () => mockEvalSetsResponse });
      }
      if (String(url).includes("/eval/capture")) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step", name: "generate_response" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/io"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    // Wait for eval sets to load and auto-select first set
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evals"))).toBe(true),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Must return a summary" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      const captureCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/eval/capture"),
      );
      expect(captureCall).toBeDefined();
      const [url, opts] = captureCall!;
      expect(url).toBe("/api/workspaces/my-ws/workflows/42/eval/capture");
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.run_id).toBe("run-123");
      expect(body.step_id).toBe("step-llm");
      expect(body.requirement).toBe("Must return a summary");
      expect(body.inputs).toEqual({ model: "gpt-4o", messages: [] });
      expect(body.outputs).toBe("some output");
      expect(body.evalSetId).toBe("set-1"); // first set auto-selected
      // prompt_resolutions mapped to prompts — resolution values excluded
      expect(body.prompts).toEqual([
        { name: "CUSTOM_ENTITY_EXTRACTION_PROMPT", prompt_id: 1552, prompt_version_id: 789 },
      ]);
    });
  });

  it("omits prompts from body when IO has no prompt_resolutions", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/io")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: { inputs: { model: "gpt-4o" }, outputs: "result" },
          }),
        });
      }
      if (String(url).endsWith("/evals")) {
        return Promise.resolve({ ok: true, json: async () => mockEvalSetsResponse });
      }
      if (String(url).includes("/eval/capture")) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step", name: "generate_response" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/io"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evals"))).toBe(true),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Must return a summary" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      const captureCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/eval/capture"),
      );
      expect(captureCall).toBeDefined();
      const body = JSON.parse((captureCall![1] as RequestInit).body as string);
      expect(body.prompts).toBeUndefined();
    });
  });

  it("creates new eval set first when 'Create new' is selected, then captures with new ref_id", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes("/io")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { inputs: { model: "gpt-4o" }, outputs: null } }),
        });
      }
      if (String(url).endsWith("/evals")) {
        const method = (opts as RequestInit | undefined)?.method;
        if (method === "POST") {
          // Create new eval set
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: { ref_id: "new-set-ref" } }),
          });
        }
        // GET /evals
        return Promise.resolve({ ok: true, json: async () => mockEvalSetsResponse });
      }
      if (String(url).includes("/eval/capture")) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/io"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    // Select "Create new"
    fireEvent.click(screen.getByTestId("eval-set-create-new"));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /new eval set name/i })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /new eval set name/i }), {
      target: { value: "My Brand New Set" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Must always respond" },
    });

    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      // POST /evals should have fired first
      const createSetCall = fetchMock.mock.calls.find(
        ([url, opts]) =>
          String(url).endsWith("/evals") && (opts as RequestInit)?.method === "POST",
      );
      expect(createSetCall).toBeDefined();
      const createBody = JSON.parse((createSetCall![1] as RequestInit).body as string);
      expect(createBody.name).toBe("My Brand New Set");

      // Capture should use the new ref_id
      const captureCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/eval/capture"),
      );
      expect(captureCall).toBeDefined();
      const captureBody = JSON.parse((captureCall![1] as RequestInit).body as string);
      expect(captureBody.evalSetId).toBe("new-set-ref");
    });
  });

  it("shows error state when eval sets fetch fails", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/io")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { inputs: { model: "gpt-4o" }, outputs: null } }),
        });
      }
      if (String(url).endsWith("/evals")) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/io"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    await waitFor(() => {
      expect(screen.getByTestId("eval-sets-error")).toBeInTheDocument();
    });

    // Submit should be blocked (no set selected)
    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Test" },
    });
    const captureBtn = screen.getByRole("button", { name: /capture/i });
    expect(captureBtn).toBeDisabled();
  });

  it("shows success toast with set name and closes form on capture", async () => {
    const { toast } = await import("sonner");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/io")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { inputs: { model: "gpt-4o" }, outputs: null } }),
        });
      }
      if (String(url).endsWith("/evals")) {
        return Promise.resolve({ ok: true, json: async () => mockEvalSetsResponse });
      }
      if (String(url).includes("/eval/capture")) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/io"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evals"))).toBe(true),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Always respond" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Eval captured into"));
      expect(screen.queryByTestId("capture-eval-form")).not.toBeInTheDocument();
    });
  });

  it("shows error toast on failed capture", async () => {
    const { toast } = await import("sonner");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/io")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { inputs: { model: "gpt-4o" }, outputs: null } }),
        });
      }
      if (String(url).endsWith("/evals")) {
        return Promise.resolve({ ok: true, json: async () => mockEvalSetsResponse });
      }
      if (String(url).includes("/eval/capture")) {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/io"))).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evals"))).toBe(true),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Must not fail" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to capture eval");
    });
  });

  it("shows error toast when ioData is null at submit time", async () => {

    const { toast } = await import("sonner");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/io")) {
        return Promise.reject(new Error("network error"));
      }
      if (String(url).endsWith("/evals")) {
        return Promise.resolve({ ok: true, json: async () => mockEvalSetsResponse });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StepDetailsModal
        step={makeLlmStep({ project_step_id: "gen_step" })}
        isOpen={true}
        onClose={vi.fn()}
        slug="my-ws"
        workflowId="42"
        projectId="run-123"
      />,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/io"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
    await waitFor(() => screen.getByTestId("capture-eval-form"));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evals"))).toBe(true),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /requirement/i }), {
      target: { value: "Test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Step input data not available");
    });
    // No capture POST should be made
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/eval/capture"))).toBe(true);
  });
});

// ── Prompts tab ───────────────────────────────────────────────────────────────

describe("StepDetailsModal — Prompts tab", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows 'Select a run to view prompt resolutions.' when projectId is undefined", async () => {
    render(<StepDetailsModal step={makeStep()} isOpen={true} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Prompts" }));

    expect(screen.getByText("Select a run to view prompt resolutions.")).toBeDefined();
  });

  it("renders prompt name as section heading with prompt_id, prompt_version_id, and resolution keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: {
              inputs: {},
              outputs: {},
              prompt_resolutions: {
                MY_PROMPT: {
                  prompt_id: 1,
                  prompt_version_id: 2,
                  resolution: { key: "val" },
                },
              },
            },
          }),
      }),
    );

    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Prompts" }));

    await waitFor(() => {
      expect(screen.getByText("MY_PROMPT")).toBeDefined();
      expect(screen.getByText("prompt_id")).toBeDefined();
      expect(screen.getByText("1")).toBeDefined();
      expect(screen.getByText("prompt_version_id")).toBeDefined();
      expect(screen.getByText("2")).toBeDefined();
      expect(screen.getByText("key")).toBeDefined();
      expect(screen.getByText("val")).toBeDefined();
    });
  });

  it("shows 'No prompt resolution data available.' when prompt_resolutions is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: { inputs: {}, outputs: {} },
          }),
      }),
    );

    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Prompts" }));

    await waitFor(() => {
      expect(screen.getByText("No prompt resolution data available.")).toBeDefined();
    });
  });

  it("shows 'No prompt resolution data available.' when prompt_resolutions is empty object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: { inputs: {}, outputs: {}, prompt_resolutions: {} },
          }),
      }),
    );

    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Prompts" }));

    await waitFor(() => {
      expect(screen.getByText("No prompt resolution data available.")).toBeDefined();
    });
  });

  it("renders multiple prompt names as separate sections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: {
              inputs: {},
              outputs: {},
              prompt_resolutions: {
                FIRST_PROMPT: {
                  prompt_id: 10,
                  prompt_version_id: 20,
                  resolution: { lang: "en" },
                },
                SECOND_PROMPT: {
                  prompt_id: 30,
                  prompt_version_id: 40,
                  resolution: { mode: "strict" },
                },
              },
            },
          }),
      }),
    );

    render(
      <StepDetailsModal
        step={makeStep({ id: "step-1" })}
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Prompts" }));

    await waitFor(() => {
      expect(screen.getByText("FIRST_PROMPT")).toBeDefined();
      expect(screen.getByText("SECOND_PROMPT")).toBeDefined();
      expect(screen.getByText("lang")).toBeDefined();
      expect(screen.getByText("mode")).toBeDefined();
    });
  });
});
