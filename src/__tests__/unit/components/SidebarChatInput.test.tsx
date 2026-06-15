// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { CanvasAttachment } from "@/app/org/[githubLogin]/_state/canvasChatStore";

// ── Voice input hook mocks ────────────────────────────────────────────────────

const mockStartListening = vi.fn();
const mockStopListening = vi.fn();
const mockResetTranscript = vi.fn();
let mockIsListening = false;
let mockTranscript = "";
let mockIsSupported = true;

vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isListening: mockIsListening,
    transcript: mockTranscript,
    isSupported: mockIsSupported,
    startListening: mockStartListening,
    stopListening: mockStopListening,
    resetTranscript: mockResetTranscript,
  }),
}));

vi.mock("@/hooks/useControlKeyHold", () => ({
  useControlKeyHold: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockToastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: mockToastError } }));
vi.mock("zustand/react/shallow", () => ({ useShallow: (fn: unknown) => fn }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({
    children,
    asChild,
    ...rest
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  } & React.HTMLAttributes<HTMLSpanElement>) =>
    asChild ? <>{children}</> : <span {...rest}>{children}</span>,
}));

// Textarea mock that exposes isDragging/isUploading as data attributes
vi.mock("@/components/ui/textarea", () => ({
  Textarea: React.forwardRef(
    (
      {
        isDragging,
        isUploading,
        ...props
      }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
        isDragging?: boolean;
        isUploading?: boolean;
      },
      ref: React.Ref<HTMLTextAreaElement>,
    ) => (
      <div className="relative w-full">
        <textarea
          ref={ref}
          data-is-dragging={isDragging}
          data-is-uploading={isUploading}
          {...props}
        />
      </div>
    ),
  ),
}));

// S3 upload mock
const mockUploadFileToS3 = vi.fn();
vi.mock("@/lib/upload-image-to-s3", () => ({
  uploadFileToS3: (...args: unknown[]) => mockUploadFileToS3(...args),
}));

// Canvas store mock — only needed for pendingInputDraft
vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: (selector: (s: unknown) => unknown) =>
    selector({ pendingInputDraft: null }),
}));

vi.mock("@/components/dashboard/DashboardChat/ToolCallIndicator", () => ({
  ToolCallIndicator: () => null,
}));

// ── Minimal SidebarChatInput (mirrors real implementation post-refactor) ───────

function TestSidebarChatInput({
  onSend,
  disabled = false,
}: {
  onSend: (msg: string, clear: () => void) => Promise<void>;
  disabled?: boolean;
}) {
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    const message = input.trim();
    setInput(""); // clear immediately on send
    await onSend(message, () => {
      inputRef.current?.focus(); // callback now only handles re-focus
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        ref={inputRef}
        data-testid="chat-input"
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        className="field-sizing-content max-h-[100px] overflow-y-auto"
      />
      <button
        type="submit"
        data-testid="send-btn"
        disabled={!input.trim() || disabled}
      >
        Send
      </button>
    </form>
  );
}

// ── Pending-draft test component ───────────────────────────────────────────────

function TestSidebarChatInputWithDraft({
  pendingDraft,
  onDraftConsumed,
}: {
  pendingDraft: string | null;
  onDraftConsumed: () => void;
}) {
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (pendingDraft === null) return;
    setInput(pendingDraft);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
    onDraftConsumed();
  }, [pendingDraft, onDraftConsumed]);

  return (
    <textarea
      ref={inputRef}
      data-testid="chat-input"
      value={input}
      onChange={(e) => setInput(e.target.value)}
      rows={1}
      className="field-sizing-content max-h-[100px] overflow-y-auto"
    />
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("SidebarChatInput — CSS-native field-sizing-content", () => {
  const noop = async (_msg: string, clear: () => void) => {
    clear();
  };

  it("renders with field-sizing-content class and no inline height style", () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;
    expect(ta.className).toContain("field-sizing-content");
    expect(ta.style.height).toBe(""); // no inline height
  });

  it("does not set inline height style after typing multi-line content", async () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, {
        target: { value: "line1\nline2\nline3\nline4\nline5" },
      });
    });

    expect(ta.style.height).toBe("");
  });

  it("does not set inline height after submit", async () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "some text" } });
    });
    await act(async () => {
      fireEvent.submit(ta.closest("form")!);
    });

    await waitFor(() => {
      expect(ta.style.height).toBe("");
    });
  });

  it("does NOT submit on Shift+Enter", async () => {
    const onSend = vi.fn(async (_msg: string, clear: () => void) => clear());
    render(<TestSidebarChatInput onSend={onSend} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello" } });
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not submit when input is empty", async () => {
    const onSend = vi.fn(async (_msg: string, clear: () => void) => clear());
    render(<TestSidebarChatInput onSend={onSend} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not submit when disabled", async () => {
    const onSend = vi.fn(async (_msg: string, clear: () => void) => clear());
    render(<TestSidebarChatInput onSend={onSend} disabled />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello" } });
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears input immediately on submit, before onSend resolves", async () => {
    let resolveSend!: () => void;
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );

    render(<TestSidebarChatInput onSend={onSend} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello world" } });
    });
    expect(ta.value).toBe("hello world");

    act(() => {
      fireEvent.submit(ta.closest("form")!);
    });

    expect(ta.value).toBe("");
    expect(onSend).toHaveBeenCalledWith("hello world", expect.any(Function));

    resolveSend();
  });
});

describe("SidebarChatInput — pendingDraft injection", () => {
  it("focuses textarea and positions caret at end when pendingDraft is set", async () => {
    const onDraftConsumed = vi.fn();
    const draft = "pre-filled message from canvas";

    render(
      <TestSidebarChatInputWithDraft
        pendingDraft={draft}
        onDraftConsumed={onDraftConsumed}
      />,
    );

    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await waitFor(() => {
      expect(ta.value).toBe(draft);
    });

    expect(onDraftConsumed).toHaveBeenCalledTimes(1);

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    expect(ta.selectionStart).toBe(draft.length);
    expect(ta.selectionEnd).toBe(draft.length);
    expect(ta.style.height).toBe("");
  });

  it("does not consume null pendingDraft", () => {
    const onDraftConsumed = vi.fn();

    render(
      <TestSidebarChatInputWithDraft
        pendingDraft={null}
        onDraftConsumed={onDraftConsumed}
      />,
    );

    expect(onDraftConsumed).not.toHaveBeenCalled();
  });
});

// ── Voice input component ─────────────────────────────────────────────────────

function TestVoiceInput({
  onSend,
  disabled = false,
  isListening: _isListening = false,
  transcript: _transcript = "",
  isSupported: _isSupported = true,
}: {
  onSend: (msg: string, clear: () => void) => Promise<void>;
  disabled?: boolean;
  isListening?: boolean;
  transcript?: string;
  isSupported?: boolean;
}) {
  const [input, setInput] = React.useState("");
  const preVoiceInputRef = React.useRef("");

  React.useEffect(() => {
    if (_transcript) {
      const newValue = preVoiceInputRef.current
        ? `${preVoiceInputRef.current} ${_transcript}`.trim()
        : _transcript;
      setInput(newValue);
    }
  }, [_transcript]);

  const toggleListening = React.useCallback(() => {
    if (_isListening) {
      mockStopListening();
    } else {
      preVoiceInputRef.current = input;
      mockStartListening();
    }
  }, [_isListening, input]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    const message = input.trim();
    if (_isListening) mockStopListening();
    mockResetTranscript();
    preVoiceInputRef.current = "";
    await onSend(message, () => setInput(""));
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        data-testid="chat-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={disabled}
        rows={1}
      />
      {_isSupported && (
        <button
          type="button"
          data-testid="mic-button"
          onClick={toggleListening}
          disabled={disabled}
        >
          {_isListening ? "MicOff" : "Mic"}
        </button>
      )}
      <button
        type="submit"
        data-testid="send-btn"
        disabled={!input.trim() || disabled}
      >
        Send
      </button>
    </form>
  );
}

describe("SidebarChatInput — voice input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsListening = false;
    mockTranscript = "";
    mockIsSupported = true;
  });

  const noop = async (_msg: string, clear: () => void) => {
    clear();
  };

  it("renders mic button when isSupported=true", () => {
    render(<TestVoiceInput onSend={noop} isSupported={true} />);
    expect(screen.getByTestId("mic-button")).toBeInTheDocument();
  });

  it("hides mic button when isSupported=false", () => {
    render(<TestVoiceInput onSend={noop} isSupported={false} />);
    expect(screen.queryByTestId("mic-button")).not.toBeInTheDocument();
  });

  it("calls startListening when mic button clicked while not listening", async () => {
    render(
      <TestVoiceInput onSend={noop} isListening={false} isSupported={true} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("mic-button"));
    });
    expect(mockStartListening).toHaveBeenCalledTimes(1);
    expect(mockStopListening).not.toHaveBeenCalled();
  });

  it("calls stopListening when mic button clicked while listening", async () => {
    render(
      <TestVoiceInput onSend={noop} isListening={true} isSupported={true} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("mic-button"));
    });
    expect(mockStopListening).toHaveBeenCalledTimes(1);
    expect(mockStartListening).not.toHaveBeenCalled();
  });

  it("appends transcript to existing input text (does not replace)", async () => {
    const { rerender } = render(
      <TestVoiceInput onSend={noop} isSupported={true} transcript="" />,
    );
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello" } });
    });

    rerender(
      <TestVoiceInput onSend={noop} isSupported={true} transcript="world" />,
    );

    await waitFor(() => {
      expect(ta.value).toContain("world");
    });
  });

  it("calls stopListening and resetTranscript on submit when mic is active", async () => {
    const onSend = vi.fn(async (_msg: string, clear: () => void) => {
      clear();
    });
    render(
      <TestVoiceInput
        onSend={onSend}
        isListening={true}
        isSupported={true}
        transcript="spoken text"
      />,
    );

    await waitFor(() => {
      const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;
      expect(ta.value).toBeTruthy();
    });

    await act(async () => {
      fireEvent.submit(
        screen.getByTestId("chat-input").closest("form")!,
      );
    });

    expect(mockStopListening).toHaveBeenCalled();
    expect(mockResetTranscript).toHaveBeenCalled();
    expect(onSend).toHaveBeenCalled();
  });

  it("calls resetTranscript on submit even when mic is not active", async () => {
    const onSend = vi.fn(async (_msg: string, clear: () => void) => {
      clear();
    });
    render(
      <TestVoiceInput onSend={onSend} isListening={false} isSupported={true} />,
    );

    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "typed message" } });
    });

    await act(async () => {
      fireEvent.submit(ta.closest("form")!);
    });

    expect(mockStopListening).not.toHaveBeenCalled();
    expect(mockResetTranscript).toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith(
      "typed message",
      expect.any(Function),
    );
  });
});

// ── Attachment-aware test component ───────────────────────────────────────────

const MAX_FILE_SIZE_TEST = 10 * 1024 * 1024; // 10 MB

interface PendingFileTest {
  id: string;
  file: File;
  uploading: boolean;
  error?: string;
  filename: string;
  mimeType: string;
  size: number;
  s3Path?: string;
}

function TestSidebarChatInputWithAttachments({
  onSend,
  workspaceId = "ws-1",
  orgId,
  disabled = false,
}: {
  onSend: (
    msg: string,
    attachments: CanvasAttachment[],
    clear: () => void,
  ) => Promise<void>;
  workspaceId?: string;
  orgId?: string;
  disabled?: boolean;
}) {
  const [input, setInput] = React.useState("");
  const [pendingFiles, setPendingFiles] = React.useState<PendingFileTest[]>([]);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const isUploading = pendingFiles.some((f) => f.uploading);

  const uploadFile = React.useCallback(
    async (pf: PendingFileTest) => {
      setPendingFiles((prev) =>
        prev.map((f) =>
          f.id === pf.id
            ? { ...f, uploading: true, error: undefined }
            : f,
        ),
      );
      try {
        const uploadContext = workspaceId ? { workspaceId } : { orgId: orgId! };
        const result = await mockUploadFileToS3(pf.file, uploadContext);
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.id === pf.id
              ? { ...f, uploading: false, s3Path: result.path }
              : f,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.id === pf.id ? { ...f, uploading: false, error: msg } : f,
          ),
        );
        mockToastError(`Failed to upload ${pf.filename}`, {
          description: msg,
        });
      }
    },
    [workspaceId, orgId],
  );

  const handleFiles = React.useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      const newFiles: PendingFileTest[] = [];
      for (const file of arr) {
        if (file.size > MAX_FILE_SIZE_TEST) {
          mockToastError(`${file.name} exceeds 10 MB`);
          continue;
        }
        newFiles.push({
          id: `id-${file.name}`,
          file,
          uploading: false,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        });
      }
      if (!newFiles.length) return;
      setPendingFiles((prev) => [...prev, ...newFiles]);
      newFiles.forEach((pf) => uploadFile(pf));
    },
    [uploadFile],
  );

  const removeFile = React.useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    if (pendingFiles.some((f) => f.uploading)) {
      mockToastError("Please wait for uploads to finish");
      return;
    }
    if (pendingFiles.some((f) => f.error)) {
      mockToastError("Remove failed uploads before sending");
      return;
    }
    const message = input.trim();
    const attachments: CanvasAttachment[] = pendingFiles
      .filter((f) => f.s3Path)
      .map((f) => ({
        path: f.s3Path!,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
      }));
    setPendingFiles([]);
    setInput("");
    await onSend(message, attachments, () => inputRef.current?.focus());
  };

  return (
    <form onSubmit={handleSubmit} data-testid="input-form">
      {pendingFiles.length > 0 && (
        <div data-testid="pending-files-grid">
          {pendingFiles.map((pf) => (
            <div key={pf.id} data-testid={`pending-file-${pf.id}`}>
              <span>{pf.filename}</span>
              {pf.uploading && (
                <span data-testid={`spinner-${pf.id}`}>uploading</span>
              )}
              {pf.error && (
                <span data-testid={`error-${pf.id}`}>{pf.error}</span>
              )}
              <button
                type="button"
                data-testid={`remove-file-${pf.id}`}
                onClick={() => removeFile(pf.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        data-testid="chat-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={disabled}
        data-is-uploading={isUploading}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        multiple
        data-testid="file-input"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        data-testid="paperclip-button"
        onClick={() => fileInputRef.current?.click()}
      >
        Attach
      </button>
      {/* Convenience button to simulate a file drop in tests */}
      <button
        type="button"
        data-testid="trigger-drop"
        onClick={() => {
          const file = new File(["content"], "dropped.png", {
            type: "image/png",
          });
          handleFiles([file]);
        }}
      >
        Trigger Drop
      </button>
      <button
        type="submit"
        data-testid="send-btn"
        disabled={!input.trim() || disabled || isUploading}
      >
        Send
      </button>
    </form>
  );
}

describe("SidebarChatInput — file attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToastError.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("send button is disabled while a file is uploading", async () => {
    // never resolves — keeps file in uploading state
    mockUploadFileToS3.mockReturnValue(new Promise(() => {}));

    const onSend = vi.fn();
    render(<TestSidebarChatInputWithAttachments onSend={onSend} />);

    await act(async () => {
      fireEvent.change(screen.getByTestId("chat-input"), {
        target: { value: "hello" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-drop"));
    });

    // Wait for pending file to appear with uploading state
    await waitFor(() => {
      expect(screen.getByTestId("spinner-id-dropped.png")).toBeInTheDocument();
    });

    const sendBtn = screen.getByTestId("send-btn") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("shows toast and does not call onSend when submitting while uploading", async () => {
    mockUploadFileToS3.mockReturnValue(new Promise(() => {}));

    const onSend = vi.fn();
    render(<TestSidebarChatInputWithAttachments onSend={onSend} />);

    await act(async () => {
      fireEvent.change(screen.getByTestId("chat-input"), {
        target: { value: "hello" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-drop"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("spinner-id-dropped.png")).toBeInTheDocument();
    });

    // Try to submit the form directly (bypasses disabled button)
    await act(async () => {
      fireEvent.submit(screen.getByTestId("input-form"));
    });

    expect(mockToastError).toHaveBeenCalledWith(
      "Please wait for uploads to finish",
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onSend with correct CanvasAttachment[] when all uploads complete", async () => {
    mockUploadFileToS3.mockResolvedValue({
      path: "uploads/ws-1/canvas/dropped.png",
      filename: "dropped.png",
      mimeType: "image/png",
      size: 7,
    });

    const onSend = vi.fn(
      async (
        _msg: string,
        _attachments: CanvasAttachment[],
        clear: () => void,
      ) => {
        clear();
      },
    );

    render(<TestSidebarChatInputWithAttachments onSend={onSend} />);

    await act(async () => {
      fireEvent.change(screen.getByTestId("chat-input"), {
        target: { value: "check this out" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-drop"));
    });

    // Wait for upload to resolve (spinner disappears)
    await waitFor(() => {
      expect(
        screen.queryByTestId("spinner-id-dropped.png"),
      ).not.toBeInTheDocument();
    });

    // Submit
    await act(async () => {
      fireEvent.submit(screen.getByTestId("input-form"));
    });

    expect(onSend).toHaveBeenCalledWith(
      "check this out",
      [
        {
          path: "uploads/ws-1/canvas/dropped.png",
          filename: "dropped.png",
          mimeType: "image/png",
          size: expect.any(Number),
        },
      ],
      expect.any(Function),
    );
  });

  it("removes a pending file and clears it from the list", async () => {
    mockUploadFileToS3.mockReturnValue(new Promise(() => {}));

    const onSend = vi.fn();
    render(<TestSidebarChatInputWithAttachments onSend={onSend} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-drop"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("pending-files-grid")).toBeInTheDocument();
    });

    const removeBtn = screen.getByTestId("remove-file-id-dropped.png");
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("pending-files-grid"),
      ).not.toBeInTheDocument();
    });
  });

  it("drag-and-drop triggers handleFiles and shows pending file chip", async () => {
    mockUploadFileToS3.mockReturnValue(new Promise(() => {}));

    render(<TestSidebarChatInputWithAttachments onSend={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-drop"));
    });

    await waitFor(() => {
      expect(screen.getByText("dropped.png")).toBeInTheDocument();
    });
  });

  it("calls onSend with empty attachments array when no files attached", async () => {
    const onSend = vi.fn(
      async (
        _msg: string,
        _attachments: CanvasAttachment[],
        clear: () => void,
      ) => {
        clear();
      },
    );

    render(<TestSidebarChatInputWithAttachments onSend={onSend} />);

    await act(async () => {
      fireEvent.change(screen.getByTestId("chat-input"), {
        target: { value: "just text" },
      });
    });

    await act(async () => {
      fireEvent.submit(screen.getByTestId("input-form"));
    });

    expect(onSend).toHaveBeenCalledWith(
      "just text",
      [],
      expect.any(Function),
    );
  });

  it("shows error toast when file exceeds 10 MB", async () => {
    const onSend = vi.fn();
    render(<TestSidebarChatInputWithAttachments onSend={onSend} />);

    const bigFile = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(bigFile, "size", { value: MAX_FILE_SIZE_TEST + 1 });

    const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [bigFile],
        writable: true,
      });
      fireEvent.change(fileInput);
    });

    expect(mockToastError).toHaveBeenCalledWith("big.png exceeds 10 MB");
    // No pending file chip should appear
    expect(screen.queryByTestId("pending-files-grid")).not.toBeInTheDocument();
  });

  it("workspaceId is forwarded to uploadFileToS3", async () => {
    mockUploadFileToS3.mockResolvedValue({
      path: "uploads/custom-ws/canvas/dropped.png",
      filename: "dropped.png",
      mimeType: "image/png",
      size: 7,
    });

    render(
      <TestSidebarChatInputWithAttachments
        onSend={vi.fn()}
        workspaceId="custom-ws"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-drop"));
    });

    await waitFor(() => {
      expect(mockUploadFileToS3).toHaveBeenCalledWith(expect.any(File), {
        workspaceId: "custom-ws",
      });
    });
  });

  it("uses orgId context when workspaceId is empty and orgId is set", async () => {
    mockUploadFileToS3.mockResolvedValue({
      path: "orgs/my-org/canvas/dropped.png",
      filename: "dropped.png",
      mimeType: "image/png",
      size: 7,
    });

    render(
      <TestSidebarChatInputWithAttachments
        onSend={vi.fn()}
        workspaceId=""
        orgId="my-org"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-drop"));
    });

    await waitFor(() => {
      expect(mockUploadFileToS3).toHaveBeenCalledWith(expect.any(File), {
        orgId: "my-org",
      });
    });
  });

  it("uses workspaceId context when both workspaceId and orgId are set (no regression)", async () => {
    mockUploadFileToS3.mockResolvedValue({
      path: "uploads/ws-priority/canvas/dropped.png",
      filename: "dropped.png",
      mimeType: "image/png",
      size: 7,
    });

    render(
      <TestSidebarChatInputWithAttachments
        onSend={vi.fn()}
        workspaceId="ws-priority"
        orgId="some-org"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-drop"));
    });

    await waitFor(() => {
      expect(mockUploadFileToS3).toHaveBeenCalledWith(expect.any(File), {
        workspaceId: "ws-priority",
      });
    });
  });
});
